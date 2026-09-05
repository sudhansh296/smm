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

      if (!order.providerOrderId) {
        // No providerOrderId  --  safe to finalize locally
        await prisma.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM orders WHERE id = ${orderId} FOR UPDATE`;
          if (!locked[0] || locked[0].status !== "CANCEL_REQUESTED") return;
          await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
          await refundOrderTx(tx as Parameters<typeof refundOrderTx>[0], orderId, {
            userId: order.userId,
            amountUsd: new Decimal(order.costUsd.toString()),
            inrRate: new Decimal(order.inrRateAtOrder.toString()),
            description: `Refund: order #${orderId.slice(-8)} cancel retry completed`,
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
        // Provider confirmed  --  get fresh remains and finalize
        let freshRemains: number | undefined;
        try {
          const freshStatus = await client.getStatus(order.providerOrderId);
          if (!("error" in freshStatus) && freshStatus.remains !== undefined) {
            const parsed = Number(freshStatus.remains);
            if (!isNaN(parsed) && Number.isInteger(parsed) && parsed >= 0 && parsed <= order.quantity) {
              freshRemains = parsed;
            }
          }
        } catch { /* use undefined  --  full refund */ }

        const refundAmount = freshRemains !== undefined && freshRemains < order.quantity
          ? new Decimal(order.costUsd.toString()).times(new Decimal(freshRemains).dividedBy(order.quantity)).toDecimalPlaces(8)
          : new Decimal(order.costUsd.toString());

        await prisma.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM orders WHERE id = ${orderId} FOR UPDATE`;
          if (!locked[0] || locked[0].status !== "CANCEL_REQUESTED") return;
          await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
          if (refundAmount.greaterThan(0)) {
            try {
              await refundOrderTx(tx as Parameters<typeof refundOrderTx>[0], orderId, {
                userId: order.userId,
                amountUsd: refundAmount,
                inrRate: new Decimal(order.inrRateAtOrder.toString()),
                description: `Refund: order #${orderId.slice(-8)} cancelled (retry confirmed)`,
              });
            } catch (err) {
              if (!(err instanceof AlreadyRefundedError)) throw err;
            }
          }
          await tx.notification.create({ data: { userId: order.userId, message: `Order #${orderId.slice(-8)} cancelled. ${refundAmount.greaterThan(0) ? `$${refundAmount.toFixed(2)} refunded.` : "No refund."}` } });
        });
        console.log(`[order-cancel] Order ${orderId}: cancel retry succeeded`);
      } else if ("error" in result) {
        // Provider still rejecting  --  throw so BullMQ retries with backoff
        throw new Error(`Provider cancel rejected: ${result.error}`);
      }
    },
    { connection: redis, skipVersionCheck: true, concurrency: 3 },
  );

  return worker;
}