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

        // Fix 5: only skip if provider row is gone entirely.
        // isEnabled controls new order routing only — all existing active orders
        // (PROCESSING, IN_PROGRESS, CANCEL_REQUESTED) must continue to be polled
        // regardless of whether the provider is currently enabled for new orders.
        if (!provider) continue;

        // All orders poll regardless of provider.isEnabled
        const ordersToCheck = orders;

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
                  // Provider cancelled — refund proportionally based on remains
                  // Fix #4: if provider reports remains, only refund undelivered portion
                  const totalCost = new Decimal(order.costUsd.toString());
                  let refundAmount: Decimal;
                  if (remains > 0 && remains < order.quantity) {
                    // Partial delivery before cancellation
                    refundAmount = totalCost.times(new Decimal(remains).dividedBy(order.quantity)).toDecimalPlaces(8);
                  } else {
                    // No delivery or full cancel — refund everything
                    refundAmount = totalCost;
                  }

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
                          amountUsd: refundAmount,
                          inrRate: new Decimal(order.inrRateAtOrder.toString()),
                          description: `Refund: order #${order.id.slice(-8)} cancelled (provider confirmed via poll)`,
                        },
                      );
                    } catch { /* already refunded — skip */ }
                    await (tx as any).notification.create({
                      data: {
                        userId: order.userId,
                        message: `Order #${order.id.slice(-8)} cancelled. $${refundAmount.toFixed(2)} refunded.`,
                      },
                    });
                  });
                  console.log(`[status-poll] Order ${order.id} CANCEL_REQUESTED → CANCELLED + refunded $${refundAmount.toFixed(2)}`);

                } else if (newStatus === "PARTIAL" && remains > 0) {
                  // Fix #7: provider delivered partial before cancel — issue proportional refund
                  const totalCost    = new Decimal(order.costUsd.toString());
                  const refundRatio  = new Decimal(remains).dividedBy(order.quantity);
                  const refundAmount = totalCost.times(refundRatio).toDecimalPlaces(8);

                  await prisma.$transaction(async (tx) => {
                    await tx.order.update({
                      where: { id: order.id },
                      data: { status: "PARTIAL" as never, remains, startCount } as never,
                    });
                    if (refundAmount.greaterThan(0)) {
                      try {
                        await refundOrderTx(
                          tx as Parameters<typeof refundOrderTx>[0],
                          order.id,
                          {
                            userId: order.userId,
                            amountUsd: refundAmount,
                            inrRate: new Decimal(order.inrRateAtOrder.toString()),
                            description: `Partial refund: ${remains} units undelivered (cancel was too late)`,
                          },
                        );
                      } catch { /* already refunded */ }
                    }
                    await (tx as any).notification.create({
                      data: {
                        userId: order.userId,
                        message: `Order #${order.id.slice(-8)} partially delivered before cancel. $${refundAmount.toFixed(2)} refunded for ${remains} undelivered units.`,
                      },
                    });
                  });
                  console.log(`[status-poll] Order ${order.id} CANCEL_REQUESTED → PARTIAL + partial refund`);

                } else if (TERMINAL_STATUSES.has(newStatus) && newStatus === "COMPLETED") {
                  // Provider fully completed before cancel — no refund, cancel was too late
                  await prisma.order.update({
                    where: { id: order.id },
                    data: { status: "COMPLETED" as never, remains, startCount } as never,
                  });
                  await (prisma as any).notification.create({
                    data: {
                      userId: order.userId,
                      message: `Order #${order.id.slice(-8)} could not be cancelled — provider already completed delivery.`,
                    },
                  });
                  console.log(`[status-poll] Order ${order.id} CANCEL_REQUESTED → COMPLETED (cancel too late)`);
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