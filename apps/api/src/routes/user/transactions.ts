import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";

const querySchema = z.object({
  page:  z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
  type:  z.enum(["DEPOSIT_INR", "DEPOSIT_USDT", "ORDER_CHARGE", "REFUND", "ADMIN_ADJUSTMENT"]).optional(),
});

export default async function transactionsRoute(fastify: FastifyInstance) {
  fastify.get("/transactions", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const q = querySchema.parse(request.query);
    const userId = request.user.sub;

    // If a specific TX type filter is applied, return pure transaction ledger (existing behaviour)
    if (q.type) {
      const skip = (q.page - 1) * q.limit;
      const where = { userId, type: q.type as never };
      const [transactions, total] = await Promise.all([
        fastify.prisma.transaction.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: q.limit }),
        fastify.prisma.transaction.count({ where }),
      ]);
      return reply.send({
        transactions: transactions.map(normalizeTransaction),
        total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit),
      });
    }

    // Unified feed: merge Transaction ledger + non-completed DepositRequests
    // Fetch all of the user's transactions and non-completed deposits in parallel
    const [allTxs, pendingDeposits] = await Promise.all([
      fastify.prisma.transaction.findMany({
        where:   { userId },
        orderBy: { createdAt: "desc" },
        take:    500, // cap to avoid loading too many
      }),
      // Only show PENDING/FAILED/CANCELLED/EXPIRED deposits (COMPLETED already has a TX row)
      fastify.prisma.depositRequest.findMany({
        where: {
          userId,
          status: { in: ["PENDING", "FAILED", "CANCELLED", "EXPIRED"] as never[] },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    ]);

    // Normalise both into a common shape
    const txItems = allTxs.map(normalizeTransaction);
    const depItems = (pendingDeposits as any[]).map(normalizeDeposit);

    // Merge and sort by createdAt descending
    const merged = [...txItems, ...depItems].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // Paginate the merged result
    const total = merged.length;
    const skip  = (q.page - 1) * q.limit;
    const page  = merged.slice(skip, skip + q.limit);

    return reply.send({
      transactions: page,
      total,
      page:       q.page,
      limit:      q.limit,
      totalPages: Math.ceil(total / q.limit),
    });
  });
}

// ── Normalizers ──────────────────────────────────────────────────

function normalizeTransaction(t: any) {
  return {
    id:          t.id,
    source:      "transaction" as const,
    type:        t.type,
    gateway:     null as string | null,
    method:      null as string | null,
    status:      "COMPLETED",
    amountUsd:   t.amountUsd.toString(),
    amountInr:   t.amountInr?.toString() ?? null,
    description: t.description,
    balanceAfter: t.balanceAfter.toString(),
    orderId:     t.orderId ?? null,
    createdAt:   t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
  };
}

function normalizeDeposit(d: any) {
  // Build a human-readable description
  let description = "Payment attempt";
  if (d.method === "MANUAL_INR")  description = "Manual Bank Transfer";
  else if (d.method === "MANUAL_USDT") description = "Manual USDT Transfer";
  else if (d.gateway === "razorpay")   description = "Razorpay";
  else if (d.gateway === "cryptomus")  description = "Cryptomus USDT";

  // Compute approx USD from INR snapshot (for display only -- wallet NOT credited)
  let amountUsd: string | null = null;
  if (d.amountUsdt) {
    amountUsd = new Decimal(d.amountUsdt.toString()).toFixed(8);
  } else if (d.amountInr && d.inrRateSnapshot) {
    amountUsd = new Decimal(d.amountInr.toString())
      .dividedBy(new Decimal(d.inrRateSnapshot.toString()))
      .toDecimalPlaces(8)
      .toFixed(8);
  }

  return {
    id:          d.id,
    source:      "deposit" as const,
    type:        d.method === "MANUAL_USDT" || d.gateway === "cryptomus" ? "DEPOSIT_USDT" : "DEPOSIT_INR",
    gateway:     d.gateway as string | null,
    method:      d.method as string | null,
    status:      d.status as string,
    amountUsd:   null as null,     // NOT a wallet credit -- do not show as +$X
    approxUsd:   amountUsd,           // display only -- no wallet movement
    amountInr:   d.amountInr?.toString() ?? null,
    description,
    balanceAfter: null as null,    // no balance change
    orderId:     null as null,
    createdAt:   d.createdAt instanceof Date ? d.createdAt.toISOString() : d.createdAt,
  };
}