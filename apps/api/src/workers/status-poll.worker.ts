import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import type { PrismaClient } from "@nexussmm/db";
import { ProviderClient } from "../services/provider.service.js";
import { creditWalletTx } from "../services/wallet.service.js";
import { Decimal } from "decimal.js";

const PROVIDER_STATUS_MAP: Record<string, string> = {
  Pending: "PENDING",
  Processing: "PROCESSING",
  "In progress": "IN_PROGRESS",
  Completed: "COMPLETED",
  Partial: "PARTIAL",
  Cancelled: "CANCELLED",
  Canceled: "CANCELLED",
};

const TERMINAL_STATUSES = new Set(["COMPLETED", "PARTIAL", "CANCELLED"]);
const REFUND_ON = new Set(["PARTIAL", "CANCELLED"]);

export function createStatusPollWorker(redis: Redis, prisma: PrismaClient) {
  const worker = new Worker(
    "status-poll",
    async (_job: Job) => {
      const openOrders = await prisma.order.findMany({
        where: {
          status: { in: ["PENDING", "PROCESSING", "IN_PROGRESS"] },
          providerOrderId: { not: null },
        },
        include: {
          service: { include: { provider: true } },
        },
      });

      if (!openOrders.length) return;

      // Group by FULFILLMENT provider (not service provider — backup may have been used)
      const byProvider = new Map<string, typeof openOrders>();
      for (const order of openOrders) {
        // Use fulfillmentProviderId if set, otherwise fall back to service provider
        const pid = (order as any).fulfillmentProviderId ?? order.service.providerId;
        if (!byProvider.has(pid)) byProvider.set(pid, []);
        byProvider.get(pid)!.push(order);
      }

      for (const [providerId, orders] of byProvider) {
        // Load the actual fulfillment provider
        const provider = await prisma.provider.findUnique({ where: { id: providerId } });
        if (!provider || !provider.isEnabled) continue;

        const client = new ProviderClient(provider);

        const CHUNK = 100;
        for (let i = 0; i < orders.length; i += CHUNK) {
          const chunk = orders.slice(i, i + CHUNK);
          const ids = chunk.map((o) => o.providerOrderId!);

          try {
            const statuses = await client.getMultiStatus(ids);

            for (const order of chunk) {
              const provId = order.providerOrderId!;
              const data = statuses[provId];
              if (!data || data.error) continue;

              const newStatus = PROVIDER_STATUS_MAP[data.status ?? ""] ?? order.status;
              const remains = data.remains ?? order.remains ?? 0;

              if (newStatus === order.status && remains === (order.remains ?? 0)) continue;

              if (TERMINAL_STATUSES.has(newStatus) && REFUND_ON.has(newStatus) && remains > 0) {
                // Partial/cancelled — refund undelivered portion atomically
                const totalCost = new Decimal(order.costUsd.toString());
                const refundRatio = new Decimal(remains).dividedBy(order.quantity);
                const refundAmount = totalCost.times(refundRatio).toDecimalPlaces(8);

                if (refundAmount.greaterThan(0)) {
                  // Single transaction: update order + credit wallet (no nesting)
                  await prisma.$transaction(async (tx) => {
                    await tx.order.update({
                      where: { id: order.id },
                      data: { status: newStatus as never, remains },
                    });

                    await creditWalletTx(
                      tx as Parameters<typeof creditWalletTx>[0],
                      order.userId,
                      refundAmount,
                      {
                        type: "REFUND",
                        description: `Refund: ${remains} units undelivered for order #${order.id}`,
                        orderId: order.id,
                        inrRate: new Decimal(order.inrRateAtOrder.toString()),
                      },
                    );

                    await tx.notification.create({
                      data: {
                        userId: order.userId,
                        message: `Order #${order.id} ${newStatus.toLowerCase()}: $${refundAmount.toFixed(2)} refunded for ${remains} undelivered units.`,
                      },
                    });
                  });
                }
              } else {
                await prisma.order.update({
                  where: { id: order.id },
                  data: { status: newStatus as never, remains },
                });
              }
            }
          } catch (err) {
            console.error(`[status-poll] Provider ${providerId} batch error:`, err);
          }
        }
      }

      console.log(`[status-poll] Polled ${openOrders.length} open orders`);
    },
    { connection: redis, skipVersionCheck: true, concurrency: 1 },
  );

  return worker;
}