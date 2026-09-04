import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import type { PrismaClient } from "@nexussmm/db";
import { ProviderClient } from "../services/provider.service.js";
import { refundOrderTx } from "../services/wallet.service.js";
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
        include: { service: { include: { provider: true } } },
      });

      if (!openOrders.length) return;

      // Group by FULFILLMENT provider — backup provider may have handled the order
      const byProvider = new Map<string, typeof openOrders>();
      for (const order of openOrders) {
        const pid = (order as any).fulfillmentProviderId ?? order.service.providerId;
        if (!byProvider.has(pid)) byProvider.set(pid, []);
        byProvider.get(pid)!.push(order);
      }

      for (const [providerId, orders] of byProvider) {
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
              const data = statuses[provId] as any;
              if (!data || data.error) continue;

              const newStatus = PROVIDER_STATUS_MAP[data.status ?? ""] ?? order.status;
              const remains = data.remains ?? order.remains ?? 0;
              // Fix #17: update startCount from provider when available
              const startCount = (data.start_count !== undefined && data.start_count !== null)
                ? Number(data.start_count)
                : order.startCount;

              // Skip if nothing changed
              if (
                newStatus === order.status &&
                remains === (order.remains ?? 0) &&
                startCount === order.startCount
              ) continue;

              if (TERMINAL_STATUSES.has(newStatus) && REFUND_ON.has(newStatus) && remains > 0) {
                const totalCost = new Decimal(order.costUsd.toString());
                const refundRatio = new Decimal(remains).dividedBy(order.quantity);
                const refundAmount = totalCost.times(refundRatio).toDecimalPlaces(8);

                if (refundAmount.greaterThan(0)) {
                  await prisma.$transaction(async (tx) => {
                    await (tx as any).order.update({
                      where: { id: order.id },
                      data: { status: newStatus as never, remains, startCount } as never,
                    });

                    // Bug 1 fix: use refundOrderTx — checks refundedAt to prevent double-refund
                    try {
                      await refundOrderTx(
                        tx as Parameters<typeof refundOrderTx>[0],
                        order.id,
                        {
                          userId: order.userId,
                          amountUsd: refundAmount,
                          inrRate: new Decimal(order.inrRateAtOrder.toString()),
                          description: `Refund: ${remains} units undelivered for order #${order.id}`,
                        },
                      );
                    } catch (alreadyRefunded) {
                      // Already refunded — skip wallet credit, just update status
                      console.warn(`[status-poll] Order ${order.id} already refunded, skipping wallet credit`);
                    }

                    await (tx as any).notification.create({
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
                  data: { status: newStatus as never, remains, startCount } as never,
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