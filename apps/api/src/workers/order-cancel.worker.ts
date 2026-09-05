import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import type { PrismaClient } from "@nexussmm/db";
import { ProviderClient } from "../services/provider.service.js";
import { refundOrderTx } from "../services/wallet.service.js";
import { AlreadyRefundedError } from "../lib/errors.js";
import { Decimal } from "decimal.js";

export function createOrderCancelWorker(redis: Redis, prisma: PrismaClient) {
  const worker = new Worker<{ orderId: string }>(
    "order-cancel",
    async (job: Job<{ orderId: string }>) => {
      const { orderId } = job.data;

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { service: { include: { provider: true } } },
      }) as any;

      if (!order) {
        console.warn(`[order-cancel] Order ${orderId} not found  --  skipping`);
        return;
      }

      // Only retry if still CANCEL_REQUESTED
      if (order.status !== "CANCEL_REQUESTED") {
        console.log(`[order-cancel] Order ${orderId} is now ${order.status}  --  no retry needed`);
        return;
      }

      // Fix 3: No providerOrderId — re-read with row lock to check for race
      // (FORWARDING→CANCEL_REQUESTED race: providerOrderId may appear between reads)
      if (!order.providerOrderId) {
        await prisma.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<Array<{ status: string; providerOrderId: string | null }>>`
            SELECT status, "providerOrderId" FROM orders WHERE id = ${orderId} FOR UPDATE
          `;
          if (!locked[0] || locked[0].status !== "CANCEL_REQUESTED") return;
          // If providerOrderId appeared since we last read, abort — status-poll will handle
          if (locked[0].providerOrderId) {
            console.warn(`[order-cancel] Order ${orderId}: providerOrderId appeared during retry  --  deferring to status-poll`);
            return;
          }
          // Truly no provider involvement — safe to refund
          await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
          await refundOrderTx(tx as Parameters<typeof refundOrderTx>[0], orderId, {
            userId: order.userId,
            amountUsd: new Decimal(order.costUsd.toString()),
            inrRate: new Decimal(order.inrRateAtOrder.toString()),
            description: `Refund: order #${orderId.slice(-8)} cancel retry completed (no provider)`,
          });
          await tx.notification.create({ data: { userId: order.userId, message: `Order #${orderId.slice(-8)} cancelled and refunded.` } });
        });
        return;
      }

      // Re-send cancel request to provider
      const fulfillmentProviderId = order.fulfillmentProviderId ?? order.service.providerId;
      let provider = order.service.provider;
      if (fulfillmentProviderId !== order.service.providerId) {
        const alt = await prisma.provider.findUnique({ where: { id: fulfillmentProviderId } });
        if (alt) provider = alt;
      }

      const client = new ProviderClient(provider);
      const result = await client.cancelOrder(order.providerOrderId);

      if ("cancel" in result && result.cancel === 1) {
        // Fix 4: cancel:1 = cancel request accepted, NOT confirmed cancelled.
        // The order could still complete. Keep CANCEL_REQUESTED and let status-poll
        // finalize when the provider reports actual terminal status.
        console.log(`[order-cancel] Order ${orderId}: cancel accepted by provider (cancel:1). Keeping CANCEL_REQUESTED for status-poll to confirm.`);
        return;
      } else if ("error" in result) {
        // Provider still rejecting — throw so BullMQ retries with backoff
        throw new Error(`Provider cancel rejected: ${result.error}`);
      }

      // Fix 2 (was in the old cancel:1 block): if we reach here the response was neither
      // cancel:1 nor an error object — unknown response, throw to retry
      throw new Error(`Unexpected provider cancel response: ${JSON.stringify(result)}`);
    },
    { connection: redis, skipVersionCheck: true, concurrency: 3 },
  );

  return worker;
}
