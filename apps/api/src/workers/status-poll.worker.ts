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

function calcRefundAmount(costUsd: string, quantity: number, remains: number): Decimal {
  const total = new Decimal(costUsd);
  if (remains === 0)       return new Decimal(0);
  if (remains >= quantity) return total;
  return total.times(new Decimal(remains).dividedBy(quantity)).toDecimalPlaces(8);
}

export function createStatusPollWorker(redis: Redis, prisma: PrismaClient) {
  const worker = new Worker(
    "status-poll",
    async (_job: Job) => {
      // Include CANCEL_REQUESTED to finalize pending cancellations
      const openOrders = await prisma.order.findMany({
        where: {
          status: { in: ["PENDING", "PROCESSING", "IN_PROGRESS", "CANCEL_REQUESTED"] } as never,
          providerOrderId: { not: null },
        },
        include: { service: { include: { provider: true } } },
      });

      if (!openOrders.length) return;

      const byProvider = new Map<string, typeof openOrders>();
      for (const order of openOrders) {
        const pid = (order as any).fulfillmentProviderId ?? order.service.providerId;
        if (!byProvider.has(pid)) byProvider.set(pid, []);
        byProvider.get(pid)!.push(order);
      }

      for (const [providerId, orders] of byProvider) {
        const provider = await prisma.provider.findUnique({ where: { id: providerId } });
        if (!provider) continue;

        const client = new ProviderClient(provider);
        const CHUNK = 100;

        for (let i = 0; i < orders.length; i += CHUNK) {
          const chunk = orders.slice(i, i + CHUNK);
          const ids = chunk.map((o) => o.providerOrderId!);

          try {
            const statuses = await client.getMultiStatus(ids);

            for (const order of chunk) {
              // Fix 4: per-order isolation  --  one bad order does not abort the chunk
              try {
                // Fix 1: const data was missing  --  added here
                const data = statuses[order.providerOrderId!] as any;
                if (!data || data.error) continue;

                const newStatus = PROVIDER_STATUS_MAP[data.status ?? ""] ?? null;

                // Fix 10: missing remains from provider = unknown, not 0
                // 0 = "fully delivered = no refund"  --  financial decision we need confirmation for
                const rawRemains   = data.remains !== undefined ? Number(data.remains) : null;
                // Fix 5: validate remains  --  must be integer in [0, quantity]
                const remainsKnown = (
                  rawRemains !== null &&
                  !isNaN(rawRemains) &&
                  Number.isInteger(rawRemains) &&
                  rawRemains >= 0 &&
                  rawRemains <= order.quantity
                );
                const remains      = remainsKnown ? rawRemains! : (order.remains ?? 0);
                const startCount   = (data.start_count !== null && data.start_count !== undefined)
                  ? Number(data.start_count) : order.startCount;

                // -- CANCEL_REQUESTED -----------------------------------------
                if ((order as any).status === "CANCEL_REQUESTED") {
                  if (!newStatus) continue;

                  if (newStatus === "CANCELLED") {
                    // Fix 10: if remains unknown, defer  --  do NOT assume 0
                    if (!remainsKnown) {
                      console.warn(`[status-poll] Order ${order.id}: CANCELLED but remains unknown  --  deferring refund`);
                      continue; // keep CANCEL_REQUESTED, try next poll
                    }
                    const refundAmount = calcRefundAmount(order.costUsd.toString(), order.quantity, remains);
                    await prisma.$transaction(async (tx) => {
                      // Fix 6: row lock + status check before finalizing
                      const locked = await tx.$queryRaw<Array<{ status: string }>>`
                        SELECT status FROM orders WHERE id = ${order.id} FOR UPDATE
                      `;
                      if (!locked[0] || locked[0].status !== "CANCEL_REQUESTED") return;
                      await tx.order.update({
                        where: { id: order.id },
                        data: { status: "CANCELLED" as never, remains, startCount } as never,
                      });
                      if (refundAmount.greaterThan(0)) {
                        try {
                          await refundOrderTx(tx as Parameters<typeof refundOrderTx>[0], order.id, {
                            userId:      order.userId,
                            amountUsd:   refundAmount,
                            inrRate:     new Decimal(order.inrRateAtOrder.toString()),
                            description: `Refund: order #${order.id.slice(-8)} cancelled (provider confirmed)`,
                          });
                        } catch (err) {
                          if (err instanceof AlreadyRefundedError) {
                            console.log(`[status-poll] Order ${order.id} already refunded  --  skipping`);
                          } else { throw err; }
                        }
                      }
                      await (tx as any).notification.create({ data: {
                        userId:  order.userId,
                        message: `Order #${order.id.slice(-8)} cancelled. ${refundAmount.greaterThan(0) ? `$${refundAmount.toFixed(2)} refunded.` : "No refund (already delivered)."}`,
                      }});
                    });
                    console.log(`[status-poll] ${order.id} CANCEL_REQUESTED->CANCELLED refund=$${calcRefundAmount(order.costUsd.toString(), order.quantity, remains).toFixed(2)}`);

                  } else if (newStatus === "PARTIAL" && remainsKnown && remains > 0) {
                    const refundAmount = calcRefundAmount(order.costUsd.toString(), order.quantity, remains);
                    await prisma.$transaction(async (tx) => {
                      // Fix 6: row lock + status check before finalizing
                      const locked = await tx.$queryRaw<Array<{ status: string }>>`
                        SELECT status FROM orders WHERE id = ${order.id} FOR UPDATE
                      `;
                      if (!locked[0] || locked[0].status !== "CANCEL_REQUESTED") return;
                      await tx.order.update({ where: { id: order.id }, data: { status: "PARTIAL" as never, remains, startCount } as never });
                      if (refundAmount.greaterThan(0)) {
                        try {
                          await refundOrderTx(tx as Parameters<typeof refundOrderTx>[0], order.id, {
                            userId:      order.userId,
                            amountUsd:   refundAmount,
                            inrRate:     new Decimal(order.inrRateAtOrder.toString()),
                            description: `Partial refund: ${remains} units undelivered (cancel was too late)`,
                          });
                        } catch (err) {
                          if (err instanceof AlreadyRefundedError) {
                            console.log(`[status-poll] Order ${order.id} already refunded  --  skipping`);
                          } else { throw err; }
                        }
                      }
                      await (tx as any).notification.create({ data: {
                        userId:  order.userId,
                        message: `Order #${order.id.slice(-8)} partially delivered before cancel. $${refundAmount.toFixed(2)} refunded.`,
                      }});
                    });

                  } else if (newStatus === "COMPLETED") {
                    // Fix 6: row lock + status check before finalizing
                    await prisma.$transaction(async (tx) => {
                      const locked = await tx.$queryRaw<Array<{ status: string }>>`
                        SELECT status FROM orders WHERE id = ${order.id} FOR UPDATE
                      `;
                      if (!locked[0] || locked[0].status !== "CANCEL_REQUESTED") return;
                      await tx.order.update({ where: { id: order.id }, data: { status: "COMPLETED" as never, remains, startCount } as never });
                      await (tx as any).notification.create({ data: {
                        userId:  order.userId,
                        message: `Order #${order.id.slice(-8)} could not be cancelled  --  provider already completed delivery.`,
                      }});
                    });
                  }
                  // PROCESSING/IN_PROGRESS  --  leave as CANCEL_REQUESTED
                  continue;
                }

                // -- Normal order ---------------------------------------------
                if (!newStatus) continue;
                if (
                  newStatus === order.status &&
                  remains === (order.remains ?? 0) &&
                  startCount === order.startCount
                ) continue;

                if (TERMINAL_STATUSES.has(newStatus) && REFUND_ON.has(newStatus)) {
                  // Fix 10: unknown remains  --  leave order in current open status, retry next poll
                  // Do NOT move to terminal state without knowing refund amount
                  if (!remainsKnown) {
                    console.warn(`[status-poll] Order ${order.id}: ${newStatus} but remains unknown  --  keeping current status for next poll`);
                    // Update startCount only, keep current status so order remains pollable
                    await prisma.order.update({ where: { id: order.id }, data: { startCount } as never });
                    continue;
                  }

                  const refundAmount = calcRefundAmount(order.costUsd.toString(), order.quantity, remains);
                  if (refundAmount.greaterThan(0)) {
                    await prisma.$transaction(async (tx) => {
                      await (tx as any).order.update({ where: { id: order.id }, data: { status: newStatus as never, remains, startCount } as never });
                      try {
                        await refundOrderTx(tx as Parameters<typeof refundOrderTx>[0], order.id, {
                          userId:      order.userId,
                          amountUsd:   refundAmount,
                          inrRate:     new Decimal(order.inrRateAtOrder.toString()),
                          description: `Refund: ${remains} units undelivered for order #${order.id}`,
                        });
                      } catch (err) {
                        if (err instanceof AlreadyRefundedError) {
                          console.log(`[status-poll] Order ${order.id} already refunded  --  skipping`);
                        } else { throw err; }
                      }
                      await (tx as any).notification.create({ data: {
                        userId:  order.userId,
                        message: `Order #${order.id} ${newStatus.toLowerCase()}: $${refundAmount.toFixed(2)} refunded for ${remains} undelivered units.`,
                      }});
                    });
                  } else {
                    await prisma.order.update({ where: { id: order.id }, data: { status: newStatus as never, remains, startCount } as never });
                  }
                } else {
                  await prisma.order.update({ where: { id: order.id }, data: { status: newStatus as never, remains, startCount } as never });
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
