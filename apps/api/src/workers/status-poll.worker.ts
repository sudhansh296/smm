import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import type { PrismaClient } from "@nexussmm/db";
import { ProviderClient } from "../services/provider.service.js";
import { refundOrderTx } from "../services/wallet.service.js";
import { Decimal } from "decimal.js";

const PROVIDER_STATUS_MAP: Record<string, string> = {
  Pending:      "PENDING",
  Processing:   "PROCESSING",
  "In progress":"IN_PROGRESS",
  Completed:    "COMPLETED",
  Partial:      "PARTIAL",
  Cancelled:    "CANCELLED",
  Canceled:     "CANCELLED",
};

const TERMINAL_STATUSES  = new Set(["COMPLETED", "PARTIAL", "CANCELLED"]);
const REFUND_ON          = new Set(["PARTIAL", "CANCELLED"]);

export function createStatusPollWorker(redis: Redis, prisma: PrismaClient) {
  const worker = new Worker(
    "status-poll",
    async (_job: Job) => {
      // Fix 4: include CANCEL_REQUESTED so we see when provider finally cancels
      const openOrders = await prisma.order.findMany({
        where: {
          status: { in: ["PENDING", "PROCESSING", "IN_PROGRESS", "CANCEL_REQUESTED"] } as never,
          providerOrderId: { not: null },
        },
        include: { service: { include: { provider: true } } },
      });

      if (!openOrders.length) return;

      // Group by FULFILLMENT provider
      const byProvider = new Map<string, typeof openOrders>();
      for (const order of openOrders) {
        const pid = (order as any).fulfillmentProviderId ?? order.service.providerId;
        if (!byProvider.has(pid)) byProvider.set(pid, []);
        byProvider.get(pid)!.push(order);
      }

      for (const [providerId, orders] of byProvider) {
        const provider = await prisma.provider.findUnique({ where: { id: providerId } });

        // Fix 5: disabled provider = no NEW orders, but existing orders still need status polling
        // Only skip if provider row is gone entirely
        if (!provider) continue;

        // If provider is disabled, skip for active orders but still poll CANCEL_REQUESTED
        // (user is waiting for cancellation confirmation regardless of provider status)
        const ordersToCheck = provider.isEnabled
          ? orders
          : orders.filter((o) => (o as any).status === "CANCEL_REQUESTED");

        if (!ordersToCheck.length) continue;

        const client = new ProviderClient(provider);
        const CHUNK = 100;

        for (let i = 0; i < ordersToCheck.length; i += CHUNK) {
          const chunk = ordersToCheck.slice(i, i + CHUNK);
          const ids = chunk.map((o) => o.providerOrderId!);

          try {
            const statuses = await client.getMultiStatus(ids);

            for (const order of chunk) {
              const provId = order.providerOrderId!;
              const data = statuses[provId] as any;
              if (!data || data.error) continue;

              const newStatus = PROVIDER_STATUS_MAP[data.status ?? ""] ?? null;
              const remains  = data.remains ?? order.remains ?? 0;
              const startCount = (data.start_count !== undefined && data.start_count !== null)
                ? Number(data.start_count)
                : order.startCount;

              // Fix 4: special handling for CANCEL_REQUESTED orders
              if ((order as any).status === "CANCEL_REQUESTED") {
                if (!newStatus) continue;

                if (newStatus === "CANCELLED") {
                  // Provider finally cancelled — finalise: CANCELLED + refund
                  await prisma.$transaction(async (tx) => {
                    await tx.order.update({
                      where: { id: order.id },
                      data: { status: "CANCELLED" as never, remains, startCount } as never,
                    });
                    try {
                      await refundOrderTx(
                        tx as Parameters<typeof refundOrderTx>[0],
                        order.id,
                        {
                          userId: order.userId,
                          amountUsd: new Decimal(order.costUsd.toString()),
                          inrRate: new Decimal(order.inrRateAtOrder.toString()),
                          description: `Refund: order #${order.id.slice(-8)} cancelled (provider confirmed via poll)`,
                        },
                      );
                    } catch { /* already refunded — skip */ }
                    await (tx as any).notification.create({
                      data: {
                        userId: order.userId,
                        message: `Order #${order.id.slice(-8)} cancelled and fully refunded.`,
                      },
                    });
                  });
                  console.log(`[status-poll] Order ${order.id} CANCEL_REQUESTED → CANCELLED + refunded`);

                } else if (TERMINAL_STATUSES.has(newStatus) && newStatus !== "CANCELLED") {
                  // Provider completed/partially completed before cancel went through
                  // Do NOT refund — provider delivered, cancel was too late
                  await prisma.order.update({
                    where: { id: order.id },
                    data: { status: newStatus as never, remains, startCount } as never,
                  });
                  await (prisma as any).notification.create({
                    data: {
                      userId: order.userId,
                      message: `Order #${order.id.slice(-8)} could not be cancelled — provider already ${newStatus.toLowerCase()}.`,
                    },
                  });
                  console.log(`[status-poll] Order ${order.id} CANCEL_REQUESTED → ${newStatus} (provider completed)`);
                }
                // Provider still Processing/In_progress — leave as CANCEL_REQUESTED
                continue;
              }

              // Normal order status update
              if (!newStatus) continue;
              if (
                newStatus === order.status &&
                remains === (order.remains ?? 0) &&
                startCount === order.startCount
              ) continue;

              if (TERMINAL_STATUSES.has(newStatus) && REFUND_ON.has(newStatus) && remains > 0) {
                const totalCost    = new Decimal(order.costUsd.toString());
                const refundRatio  = new Decimal(remains).dividedBy(order.quantity);
                const refundAmount = totalCost.times(refundRatio).toDecimalPlaces(8);

                if (refundAmount.greaterThan(0)) {
                  await prisma.$transaction(async (tx) => {
                    await (tx as any).order.update({
                      where: { id: order.id },
                      data: { status: newStatus as never, remains, startCount } as never,
                    });
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
                    } catch { console.warn(`[status-poll] Order ${order.id} already refunded, skipping`); }
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