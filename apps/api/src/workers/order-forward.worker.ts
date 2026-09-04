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

      // Idempotency: if order already has a providerOrderId, it was forwarded on a prior attempt
      // Do NOT re-send to provider — just ensure status is PROCESSING
      if (order.providerOrderId) {
        console.log(`[order-forward] Order ${orderId} already forwarded (providerOrderId=${order.providerOrderId}), updating status`);
        if (order.status === "PENDING") {
          // Bug 2 fix: conditional update — only if still PENDING
          await prisma.order.updateMany({
            where: { id: orderId, status: "PENDING" },
            data: { status: "PROCESSING" },
          });
        }
        return;
      }

      if (order.status !== "PENDING") {
        console.log(`[order-forward] Order ${orderId} already processed (${order.status})`);
        return;
      }

      // Bug 3 fix: Redis forwarding lock — prevents duplicate upstream orders on retry
      const lockKey = `order-forward-lock:${orderId}`;
      const lockAcquired = await redis.set(lockKey, "1", "EX", 120, "NX");

      if (!lockAcquired) {
        // A previous attempt sent to provider but we lost the response
        // Don't retry — mark for manual review (no refund yet — admin must check provider dashboard)
        const stillPending = await prisma.order.updateMany({
          where: { id: orderId, status: "PENDING", providerOrderId: null },
          data: { status: "CANCELLED" },
        });
        if (stillPending.count > 0) {
          console.error(`[order-forward] Order ${orderId}: lost provider response. Marked CANCELLED for manual review. Check provider dashboard.`);
        }
        return;
      }

      // Renew lock before calling provider (in case lock expired between check and call)
      await redis.set(lockKey, "1", "EX", 120);

      // ── Try PRIMARY provider ─────────────────────────────────
      const primaryClient = new ProviderClient(order.service.provider);
      const result = await primaryClient.addOrder(order.service.providerServiceId, order.link, order.quantity);

      if (!("error" in result)) {
        // Bug 2 fix: conditional update — only update if order is still PENDING
        const updated = await prisma.order.updateMany({
          where: { id: orderId, status: "PENDING" },
          data: { status: "PROCESSING", providerOrderId: result.order.toString(), fulfillmentProviderId: order.service.providerId } as never,
        });
        if (updated.count === 0) {
          // Order was cancelled while we were talking to provider
          console.warn(`[order-forward] Order ${orderId} was cancelled while provider was processing it. Provider order: ${result.order}. Manual review needed.`);
          return;
        }
        console.log(`[order-forward] Order ${orderId} forwarded via PRIMARY → ${result.order}`);
        return;
      }

      // ── Primary failed → try BACKUP provider ─────────────────
      console.warn(`[order-forward] Primary failed for ${orderId}: ${result.error}`);

      const backupProviderId = order.service.backupProviderId;
      const backupServiceId = order.service.backupProviderServiceId;

      if (backupProviderId && backupServiceId) {
        const backupProvider = await prisma.provider.findUnique({ where: { id: backupProviderId } });

        if (backupProvider?.isEnabled) {
          const backupClient = new ProviderClient(backupProvider);
          const backupResult = await backupClient.addOrder(backupServiceId, order.link, order.quantity);

          if (!("error" in backupResult)) {
            // Bug 2 fix: conditional update — only update if order is still PENDING
            const updated = await prisma.order.updateMany({
              where: { id: orderId, status: "PENDING" },
              data: { status: "PROCESSING", providerOrderId: backupResult.order.toString(), fulfillmentProviderId: backupProviderId } as never,
            });
            if (updated.count === 0) {
              // Order was cancelled while we were talking to backup provider
              console.warn(`[order-forward] Order ${orderId} was cancelled while backup provider was processing it. Provider order: ${backupResult.order}. Manual review needed.`);
              return;
            }
            console.log(`[order-forward] Order ${orderId} forwarded via BACKUP provider ${backupProviderId}`);
            return;
          }

          throw new Error(`Both providers failed. Primary: ${result.error}. Backup: ${backupResult.error}`);
        }
      }

      throw new Error(`Provider error: ${result.error}`);
    },
    { connection: redis, skipVersionCheck: true, concurrency: 5 },
  );

  // Final failure — all retries exhausted → cancel + refund (Bug 1: use refundOrderTx)
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
        select: { costUsd: true, userId: true, inrRateAtOrder: true, status: true, refundedAt: true },
      });

      if (!order || order.status === "CANCELLED" || (order as any).refundedAt) return;

      await prisma.$transaction(async (tx) => {
        await (tx as any).order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
        await refundOrderTx(
          tx as Parameters<typeof refundOrderTx>[0],
          orderId,
          {
            userId: order.userId,
            amountUsd: new Decimal(order.costUsd.toString()),
            inrRate: new Decimal(order.inrRateAtOrder.toString()),
            description: `Auto-refund: order could not be processed (#${orderId})`,
          },
        );
        await (tx as any).notification.create({
          data: { userId: order.userId, message: `Your order #${orderId} could not be processed and has been fully refunded.` },
        });
      });

      console.log(`[order-forward] Refunded order ${orderId}`);
    } catch (refundErr) {
      console.error(`[order-forward] Refund failed for ${orderId}:`, refundErr);
    }
  });

  return worker;
}
