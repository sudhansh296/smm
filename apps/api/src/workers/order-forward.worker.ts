import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import type { PrismaClient } from "@nexussmm/db";
import type { OrderForwardJobData } from "@nexussmm/types";
import { ProviderClient } from "../services/provider.service.js";
import { refundOrderTx } from "../services/wallet.service.js";
import { Decimal } from "decimal.js";

export function createOrderForwardWorker(redis: Redis, prisma: PrismaClient) {
  const worker = new Worker<OrderForwardJobData>(
    "order-forward",
    async (job: Job<OrderForwardJobData>) => {
      const { orderId } = job.data;

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          service: { include: { provider: true } },
          user: { select: { id: true } },
        },
      });

      if (!order) {
        console.warn(`[order-forward] Order ${orderId} not found, skipping`);
        return;
      }

      // Fix 3: FORWARDING state — if order is FORWARDING, provider call is in progress
      // This means a prior attempt sent to provider; treat same as providerOrderId set
      if ((order as any).status === "FORWARDING") {
        console.warn(
          `[order-forward] Order ${orderId} is in FORWARDING state — previous attempt may have ` +
          `reached provider but response was lost. Leaving for manual admin review.`
        );
        return;
      }

      // Already forwarded — ensure PROCESSING, do not re-send
      if (order.providerOrderId) {
        console.log(`[order-forward] Order ${orderId} already forwarded (${order.providerOrderId})`);
        if (order.status === "PENDING") {
          await prisma.order.updateMany({
            where: { id: orderId, status: "PENDING" },
            data: { status: "PROCESSING" },
          });
        }
        return;
      }

      if (order.status !== "PENDING") {
        console.log(`[order-forward] Order ${orderId} not PENDING (${order.status}), skipping`);
        return;
      }

      // ── Redis lock — prevents duplicate upstream orders on BullMQ retry ──────
      // Fix 1: Lock is only held during the actual provider HTTP call.
      // On KNOWN provider error (e.g. insufficient balance, service not found),
      // we delete the lock so the next BullMQ retry can attempt again cleanly.
      // On network timeout (where provider may have accepted), lock stays until TTL.
      const lockKey = `order-forward-lock:${orderId}`;
      const lockAcquired = await redis.set(lockKey, "1", "EX", 120, "NX");

      if (!lockAcquired) {
        // Lock exists + no providerOrderId = prior attempt may have reached provider
        // but we lost the response. Cannot safely re-send — leave PENDING for admin.
        console.error(
          `[order-forward] Order ${orderId}: lock held, no providerOrderId. ` +
          `Possible lost response. Staying PENDING for admin review.`
        );
        return;
      }

      // Fix 3: Mark FORWARDING before making the provider call
      // This way, if the process crashes between the provider call and DB update,
      // the next retry sees FORWARDING and does not re-send to provider
      const markedForwarding = await prisma.order.updateMany({
        where: { id: orderId, status: "PENDING" },
        data: { status: "FORWARDING" } as never,
      });
      if (markedForwarding.count === 0) {
        // Order was cancelled between lock acquisition and here
        await redis.del(lockKey);
        console.log(`[order-forward] Order ${orderId} was cancelled before FORWARDING mark`);
        return;
      }

      try {
        // ── Try PRIMARY provider ────────────────────────────────────────────────
        const primaryClient = new ProviderClient(order.service.provider);
        const result = await primaryClient.addOrder(
          order.service.providerServiceId,
          order.link,
          order.quantity,
        );

        if (!("error" in result)) {
          await prisma.order.update({
            where: { id: orderId },
            data: {
              status: "PROCESSING",
              providerOrderId: result.order.toString(),
              fulfillmentProviderId: order.service.providerId,
            } as never,
          });
          // Lock can be deleted — we have providerOrderId now
          await redis.del(lockKey);
          console.log(`[order-forward] Order ${orderId} forwarded via PRIMARY → ${result.order}`);
          return;
        }

        // ── Primary returned KNOWN error — try BACKUP ───────────────────────────
        // Fix 1: known provider error → delete lock so retry can attempt backup next time
        console.warn(`[order-forward] Primary failed for ${orderId}: ${result.error}`);

        const backupProviderId = order.service.backupProviderId;
        const backupServiceId = order.service.backupProviderServiceId;

        if (backupProviderId && backupServiceId) {
          const backupProvider = await prisma.provider.findUnique({ where: { id: backupProviderId } });

          if (backupProvider?.isEnabled) {
            const backupClient = new ProviderClient(backupProvider);
            const backupResult = await backupClient.addOrder(backupServiceId, order.link, order.quantity);

            if (!("error" in backupResult)) {
              await prisma.order.update({
                where: { id: orderId },
                data: {
                  status: "PROCESSING",
                  providerOrderId: backupResult.order.toString(),
                  fulfillmentProviderId: backupProviderId,
                } as never,
              });
              await redis.del(lockKey);
              console.log(`[order-forward] Order ${orderId} forwarded via BACKUP → ${backupResult.order}`);
              return;
            }

            // Both failed with known errors — delete lock and revert to PENDING for retry
            await redis.del(lockKey);
            await prisma.order.updateMany({
              where: { id: orderId, status: "FORWARDING" } as never,
              data: { status: "PENDING" },
            });
            throw new Error(`Both providers failed. Primary: ${result.error}. Backup: ${backupResult.error}`);
          }
        }

        // No backup — delete lock and revert FORWARDING→PENDING for retry
        await redis.del(lockKey);
        await prisma.order.updateMany({
          where: { id: orderId, status: "FORWARDING" } as never,
          data: { status: "PENDING" },
        });
        throw new Error(`Provider error: ${result.error}`);

      } catch (err) {
        // Network/timeout error — do NOT delete lock (provider may have accepted)
        // Revert FORWARDING→PENDING only for non-network errors (already thrown above for those)
        // For unexpected errors, revert to PENDING so admin can investigate
        const isKnownError = err instanceof Error && err.message.startsWith("Provider error:");
        const isBothFailed = err instanceof Error && err.message.startsWith("Both providers failed");
        if (!isKnownError && !isBothFailed) {
          // Unexpected error — could be network timeout — keep lock, leave as FORWARDING for manual review
          console.error(`[order-forward] Unexpected error for ${orderId}:`, err);
        }
        throw err;
      }
    },
    { connection: redis, skipVersionCheck: true, concurrency: 5 },
  );

  // All retries exhausted — only refund if provider NEVER accepted (no providerOrderId)
  worker.on("failed", async (
    job: { data: OrderForwardJobData; opts: { attempts?: number }; attemptsMade: number } | undefined,
    err: Error,
  ) => {
    if (!job || (job.opts.attempts && job.attemptsMade < job.opts.attempts)) return;

    const orderId = job.data.orderId;
    console.error(`[order-forward] Order ${orderId} exhausted all retries:`, err.message);

    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          costUsd: true, userId: true, inrRateAtOrder: true,
          status: true, refundedAt: true, providerOrderId: true,
        },
      }) as any;

      if (!order || order.refundedAt) return;

      // Provider accepted the order — do not auto-refund, needs manual review
      if (order.providerOrderId) {
        console.error(
          `[order-forward] Order ${orderId} has providerOrderId but all retries failed. Manual review needed.`
        );
        return;
      }

      // FORWARDING state = unknown whether provider got it — leave for admin
      if (order.status === "FORWARDING") {
        console.error(
          `[order-forward] Order ${orderId} stuck in FORWARDING. Provider response unknown. Manual review needed.`
        );
        return;
      }

      // PENDING with no providerOrderId — provider never accepted, safe to refund
      if (order.status !== "PENDING") return;

      await prisma.$transaction(async (tx) => {
        await (tx as any).order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
        await refundOrderTx(
          tx as Parameters<typeof refundOrderTx>[0],
          orderId,
          {
            userId: order.userId,
            amountUsd: new Decimal(order.costUsd.toString()),
            inrRate: new Decimal(order.inrRateAtOrder.toString()),
            description: `Auto-refund: order could not be forwarded to provider (#${orderId})`,
          },
        );
        await (tx as any).notification.create({
          data: { userId: order.userId, message: `Your order #${orderId} could not be processed and has been fully refunded.` },
        });
      });

      console.log(`[order-forward] Refunded order ${orderId} (provider never accepted)`);
    } catch (refundErr) {
      console.error(`[order-forward] Refund failed for ${orderId}:`, refundErr);
    }
  });

  return worker;
}