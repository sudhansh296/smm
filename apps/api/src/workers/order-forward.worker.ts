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
      // Issue 3 fix: the lock does NOT cancel or refund on lock-already-exists.
      // A lost-response case (sent to provider but DB never got providerOrderId)
      // is logged for manual review ONLY. We never auto-refund without confirmed
      // providerOrderId because the provider may be delivering the order.
      const lockKey = `order-forward-lock:${orderId}`;
      const lockAcquired = await redis.set(lockKey, "1", "EX", 120, "NX");

      if (!lockAcquired) {
        // Lock exists + no providerOrderId = previous attempt sent to provider,
        // response was lost (network timeout). Cannot safely re-send.
        // Do NOT cancel/refund — provider may be delivering. Log for manual review.
        console.error(
          `[order-forward] Order ${orderId}: forwarding lock already held with no providerOrderId. ` +
          `Possible lost response from provider. Leaving as PENDING for manual admin review. ` +
          `Check provider dashboard before deciding to cancel or confirm.`,
        );
        // Let the job complete without action — order stays PENDING
        // Admin can then either: manually set PROCESSING (if provider confirmed) or cancel+refund
        return;
      }

      // Renew lock for the duration of the provider call
      await redis.set(lockKey, "1", "EX", 120);

      // ── Try PRIMARY provider ──────────────────────────────────────────────────
      const primaryClient = new ProviderClient(order.service.provider);
      const result = await primaryClient.addOrder(
        order.service.providerServiceId,
        order.link,
        order.quantity,
      );

      if (!("error" in result)) {
        // Issue 2 fix: Cancellation-vs-forward race.
        // Use updateMany with status:"PENDING" condition so a concurrent cancel
        // (which sets CANCELLED) causes updated.count === 0 and we log the conflict.
        const updated = await prisma.order.updateMany({
          where: { id: orderId, status: "PENDING" },
          data: {
            status: "PROCESSING",
            providerOrderId: result.order.toString(),
            fulfillmentProviderId: order.service.providerId,
          } as never,
        });

        if (updated.count === 0) {
          // Order was cancelled while provider was already processing it.
          // Wallet refund already happened via cancel flow.
          // Provider will continue delivering — admin needs to reconcile.
          console.warn(
            `[order-forward] Order ${orderId} was cancelled while provider was processing it. ` +
            `Provider order: ${result.order}. ` +
            `Wallet already refunded by cancel flow. Admin must cancel on provider side manually.`,
          );
        } else {
          console.log(`[order-forward] Order ${orderId} forwarded via PRIMARY → ${result.order}`);
        }
        return;
      }

      // ── Primary failed — try BACKUP ───────────────────────────────────────────
      console.warn(`[order-forward] Primary failed for ${orderId}: ${result.error}`);

      const backupProviderId = order.service.backupProviderId;
      const backupServiceId = order.service.backupProviderServiceId;

      if (backupProviderId && backupServiceId) {
        const backupProvider = await prisma.provider.findUnique({ where: { id: backupProviderId } });

        if (backupProvider?.isEnabled) {
          const backupClient = new ProviderClient(backupProvider);
          const backupResult = await backupClient.addOrder(backupServiceId, order.link, order.quantity);

          if (!("error" in backupResult)) {
            const updated = await prisma.order.updateMany({
              where: { id: orderId, status: "PENDING" },
              data: {
                status: "PROCESSING",
                providerOrderId: backupResult.order.toString(),
                fulfillmentProviderId: backupProviderId,
              } as never,
            });

            if (updated.count === 0) {
              console.warn(
                `[order-forward] Order ${orderId} was cancelled while backup provider was processing it. ` +
                `Provider order: ${backupResult.order}. Admin must cancel on provider side manually.`,
              );
            } else {
              console.log(`[order-forward] Order ${orderId} forwarded via BACKUP → ${backupResult.order}`);
            }
            return;
          }

          throw new Error(`Both providers failed. Primary: ${result.error}. Backup: ${backupResult.error}`);
        }
      }

      // Both failed — throw so BullMQ retries (and eventually the failed handler runs)
      throw new Error(`Provider error: ${result.error}`);
    },
    { connection: redis, skipVersionCheck: true, concurrency: 5 },
  );

  // All retries exhausted — cancel + refund
  // This is safe because: if provider got the order, it would have set providerOrderId.
  // If providerOrderId is still null here, provider never accepted it.
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
      });

      // Only auto-refund if: order still PENDING and provider never accepted (no providerOrderId)
      // If providerOrderId is set, provider is delivering — do not auto-refund.
      if (!order || (order as any).refundedAt) return;
      if ((order as any).providerOrderId) {
        // Provider accepted before final failure — do not auto-refund
        console.error(`[order-forward] Order ${orderId} has providerOrderId=${(order as any).providerOrderId} but all retries failed. Manual review needed.`);
        return;
      }
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