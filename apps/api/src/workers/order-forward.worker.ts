import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import type { PrismaClient } from "@nexussmm/db";
import type { OrderForwardJobData } from "@nexussmm/types";
import { ProviderClient } from "../services/provider.service.js";
import { creditWalletTx } from "../services/wallet.service.js";
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

      if (order.status !== "PENDING") {
        console.log(`[order-forward] Order ${orderId} already processed (${order.status})`);
        return;
      }

      // ── Try PRIMARY provider ─────────────────────────────────
      const primaryClient = new ProviderClient(order.service.provider);
      const result = await primaryClient.addOrder(
        order.service.providerServiceId,
        order.link,
        order.quantity,
      );

      if (!("error" in result)) {
        // Primary succeeded — store fulfillment provider
        await prisma.order.update({
          where: { id: orderId },
          data: {
            status: "PROCESSING",
            providerOrderId: result.order.toString(),
            fulfillmentProviderId: order.service.providerId,
          } as never,
        });
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
            // Backup succeeded — store which provider actually fulfilled this order
            await prisma.order.update({
              where: { id: orderId },
              data: {
                status: "PROCESSING",
                providerOrderId: backupResult.order.toString(),
                fulfillmentProviderId: backupProviderId, // Track actual provider
              } as never,
            });
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

  // Final failure — all retries exhausted → cancel + refund (flat transaction, no nesting)
  worker.on(
    "failed",
    async (
      job: { data: OrderForwardJobData; opts: { attempts?: number }; attemptsMade: number } | undefined,
      err: Error,
    ) => {
      if (!job || (job.opts.attempts && job.attemptsMade < job.opts.attempts)) return;

      const orderId = job.data.orderId;
      console.error(`[order-forward] Order ${orderId} exhausted all retries:`, err.message);

      try {
        const order = await prisma.order.findUnique({
          where: { id: orderId },
          select: { costUsd: true, userId: true, inrRateAtOrder: true, status: true },
        });

        if (!order || order.status === "CANCELLED") return;

        // Single flat transaction — no nested prisma.$transaction calls
        await prisma.$transaction(async (tx) => {
          await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });

          // Use creditWalletTx (operates inside existing tx — no nesting)
          await creditWalletTx(
            tx as Parameters<typeof creditWalletTx>[0],
            order.userId,
            new Decimal(order.costUsd.toString()),
            {
              type: "REFUND",
              description: `Auto-refund: order could not be processed (#${orderId})`,
              orderId,
              inrRate: new Decimal(order.inrRateAtOrder.toString()),
            },
          );

          await tx.notification.create({
            data: {
              userId: order.userId,
              message: `Your order #${orderId} could not be processed and has been fully refunded.`,
            },
          });
        });

        console.log(`[order-forward] Refunded order ${orderId}`);
      } catch (refundErr) {
        console.error(`[order-forward] Refund failed for ${orderId}:`, refundErr);
      }
    },
  );

  return worker;
}