import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import type { PrismaClient } from "@nexussmm/db";
import { ProviderClient } from "../services/provider.service.js";
import { refundOrderTx } from "../services/wallet.service.js";
import { AlreadyRefundedError } from "../lib/errors.js";
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

const TERMINAL_STATUSES = new Set(["COMPLETED", "PARTIAL", "CANCELLED"]);
const REFUND_ON         = new Set(["PARTIAL", "CANCELLED"]);

// ── Shared refund amount calculator ───────────────────────────────────────────
// Fix #3: clear semantics for remains values
function calcRefundAmount(costUsd: string, quantity: number, remains: number): Decimal {
  const total = new Decimal(costUsd);
  if (remains === 0) {
    // Provider says nothing left to deliver = all delivered = no refund
    return new Decimal(0);
  }
  if (remains >= quantity) {
    // Provider says everything still undelivered = full refund
    return total;
  }
  // Partial delivery — refund proportional to undelivered units
  return total.times(new Decimal(remains).dividedBy(quantity)).toDecimalPlaces(8);
}

// ── Helper: load the actual fulfillment provider (Fix #2) ─────────────────────
async function loadFulfillmentProvider(prisma: PrismaClient, order: any) {
  const fulfillmentProviderId = order.fulfillmentProviderId ?? order.service.providerId;
  if (fulfillmentProviderId === order.service.providerId) {
    return order.service.provider;
  }
  const alt = await prisma.provider.findUnique({ where: { id: fulfillmentProviderId } });
  return alt ?? order.service.provider; // fallback to primary if backup row gone
}

export function createStatusPollWorker(redis: Redis, prisma: PrismaClient) {
  const worker = new Worker(
    "status-poll",
    async (_job: Job) => {
      const openOrders = await prisma.order.findMany({
        where: {
          status: { in: ["PENDING", "PROCESSING", "IN_PROGRESS", "CANCEL_REQUESTED"] } as never,
          providerOrderId: { not: null },
        },
        include: { service: { include: { provider: true } } },
      });

      if (!openOrders.length) return;

      // Group by FULFILLMENT provider (Fix #2 — uses actual fulfillment provider ID)
      const byProvider = new Map<string, typeof openOrders>();
      for (const order of openOrders) {
        const pid = (order as any).fulfillmentProviderId ?? order.service.providerId;
        if (!byProvider.has(pid)) byProvider.set(pid, []);
        byProvider.get(pid)!.push(order);
      }

      for (const [providerId, orders] of byProvider) {
        // Fix #2: load by providerId — this IS the fulfillment provider for all orders in this group
        const provider = await prisma.provider.findUnique({ where: { id: providerId } });
        if (!provider) continue; // provider row gone — skip

        const client = new ProviderClient(provider);
        const CHUNK = 100;

        for (let i = 0; i < orders.length; i += CHUNK) {
          const chunk = orders.slice(i, i + CHUNK);
          const ids = chunk.map((o) => o.providerOrderId!);

          try {
            const statuses = await client.getMultiStatus(ids);

            for (const order of chunk) {
              try { // Fix: per-order error isolation — one bad order does not skip rest of batch
              if (!data || data.error) continue;

              const newStatus  = PROVIDER_STATUS_MAP[data.status ?? ""] ?? null;
              // Fix: remains missing from provider = unknown, not 0
              // 0 means "fully delivered = no refund", which is a financial decision we cannot make without confirmation
              // Use existing DB value if provider omits remains
              const rawRemains = data.remains !== undefined ? Number(data.remains) : null;
              const remainsKnown = rawRemains !== null && !isNaN(rawRemains);
              const remains    = remainsKnown ? rawRemains! : (order.remains ?? 0);
              const startCount = (data.start_count !== null && data.start_count !== undefined)
                ? Number(data.start_count) : order.startCount;

              // ── CANCEL_REQUESTED: waiting for provider to confirm ─────────
              if ((order as any).status === "CANCEL_REQUESTED") {
                if (!newStatus) continue;

                if (newStatus === "CANCELLED") {
                  // Fix #4: use shared refund calculator — proportional by remains
                  const refundAmount = calcRefundAmount(order.costUsd.toString(), order.quantity, remains);

                  await prisma.$transaction(async (tx) => {
                    await tx.order.update({
                      where: { id: order.id },
                      data: { status: "CANCELLED" as never, remains, startCount } as never,
                    });
                    if (refundAmount.greaterThan(0)) {
                      // Fix #1: only catch AlreadyRefundedError — let real DB errors propagate
                      try {
                        await refundOrderTx(
                          tx as Parameters<typeof refundOrderTx>[0],
                          order.id,
                          {
                            userId:      order.userId,
                            amountUsd:   refundAmount,
                            inrRate:     new Decimal(order.inrRateAtOrder.toString()),
                            description: `Refund: order #${order.id.slice(-8)} cancelled (provider confirmed)`,
                          },
                        );
                      } catch (err) {
                        if (err instanceof AlreadyRefundedError) {
                          console.log(`[status-poll] Order ${order.id} already refunded — skipping wallet credit`);
                        } else {
                          throw err; // real error — let transaction rollback
                        }
                      }
                    }
                    await (tx as any).notification.create({
                      data: {
                        userId:  order.userId,
                        message: `Order #${order.id.slice(-8)} cancelled. ${refundAmount.greaterThan(0) ? `$${refundAmount.toFixed(2)} refunded.` : "No refund (already delivered)."}`,
                      },
                    });
                  });
                  console.log(`[status-poll] Order ${order.id} CANCEL_REQUESTED → CANCELLED refund=$${calcRefundAmount(order.costUsd.toString(), order.quantity, remains).toFixed(2)}`);

                } else if (newStatus === "PARTIAL" && remains > 0) {
                  const refundAmount = calcRefundAmount(order.costUsd.toString(), order.quantity, remains);
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
                            userId:      order.userId,
                            amountUsd:   refundAmount,
                            inrRate:     new Decimal(order.inrRateAtOrder.toString()),
                            description: `Partial refund: ${remains} units undelivered (cancel was too late)`,
                          },
                        );
                      } catch (err) {
                        if (err instanceof AlreadyRefundedError) {
                          console.log(`[status-poll] Order ${order.id} already refunded — skipping`);
                        } else {
                          throw err;
                        }
                      }
                    }
                    await (tx as any).notification.create({
                      data: {
                        userId:  order.userId,
                        message: `Order #${order.id.slice(-8)} partially delivered before cancel. $${refundAmount.toFixed(2)} refunded.`,
                      },
                    });
                  });
                  console.log(`[status-poll] Order ${order.id} CANCEL_REQUESTED → PARTIAL + refund=$${refundAmount.toFixed(2)}`);

                } else if (newStatus === "COMPLETED") {
                  await prisma.order.update({
                    where: { id: order.id },
                    data: { status: "COMPLETED" as never, remains, startCount } as never,
                  });
                  await (prisma as any).notification.create({
                    data: {
                      userId:  order.userId,
                      message: `Order #${order.id.slice(-8)} could not be cancelled — provider already completed delivery.`,
                    },
                  });
                  console.log(`[status-poll] Order ${order.id} CANCEL_REQUESTED → COMPLETED (cancel too late, no refund)`);
                }
                continue; // always skip normal flow for CANCEL_REQUESTED
              }

              // ── Normal order status update ─────────────────────────────────
              if (!newStatus) continue;
              if (
                newStatus === order.status &&
                remains === (order.remains ?? 0) &&
                startCount === order.startCount
              ) continue;

              if (TERMINAL_STATUSES.has(newStatus) && REFUND_ON.has(newStatus)) {
                // If provider omitted remains — we cannot determine refund amount safely
                // Skip financial action; next poll may have full data
                if (!remainsKnown) {
                  console.warn(`[status-poll] Order ${order.id}: ${newStatus} but remains unknown — deferring refund`);
                  await prisma.order.update({
                    where: { id: order.id },
                    data: { status: newStatus as never, startCount } as never,
                  });
                  continue;
                }
                const refundAmount = calcRefundAmount(order.costUsd.toString(), order.quantity, remains);

                if (refundAmount.greaterThan(0)) {
                  await prisma.$transaction(async (tx) => {
                    await (tx as any).order.update({
                      where: { id: order.id },
                      data: { status: newStatus as never, remains, startCount } as never,
                    });
                    // Fix #1: typed catch — only swallow AlreadyRefundedError
                    try {
                      await refundOrderTx(
                        tx as Parameters<typeof refundOrderTx>[0],
                        order.id,
                        {
                          userId:      order.userId,
                          amountUsd:   refundAmount,
                          inrRate:     new Decimal(order.inrRateAtOrder.toString()),
                          description: `Refund: ${remains} units undelivered for order #${order.id}`,
                        },
                      );
                    } catch (err) {
                      if (err instanceof AlreadyRefundedError) {
                        console.log(`[status-poll] Order ${order.id} already refunded — skipping`);
                      } else {
                        throw err; // real error — rollback transaction
                      }
                    }
                    await (tx as any).notification.create({
                      data: {
                        userId:  order.userId,
                        message: `Order #${order.id} ${newStatus.toLowerCase()}: $${refundAmount.toFixed(2)} refunded for ${remains} undelivered units.`,
                      },
                    });
                  });
                } else {
                  // remains=0 — nothing to refund, just update status
                  await prisma.order.update({
                    where: { id: order.id },
                    data: { status: newStatus as never, remains, startCount } as never,
                  });
                }
              } else {
                await prisma.order.update({
                  where: { id: order.id },
                  data: { status: newStatus as never, remains, startCount } as never,
                });
              }
              } catch (orderErr) {
                console.error(`[status-poll] Error processing order ${order.id}:`, orderErr);
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