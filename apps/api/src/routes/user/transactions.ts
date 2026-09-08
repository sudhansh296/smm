import type { FastifyInstance } from "fastify";
import { z } from "zod";

const querySchema = z.object({
  page:  z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
  type:  z.enum(["DEPOSIT_INR", "DEPOSIT_USDT", "ORDER_CHARGE", "REFUND", "ADMIN_ADJUSTMENT"]).optional(),
});

export default async function transactionsRoute(fastify: FastifyInstance) {
  fastify.get("/transactions", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const q = querySchema.parse(request.query);
    const userId = request.user.sub;
    const offset = (q.page - 1) * q.limit;

    // Pure-ledger filters: ORDER_CHARGE, REFUND, ADMIN_ADJUSTMENT
    // These only exist in Transaction table -- no DepositRequest to merge
    const pureLedgerTypes = ["ORDER_CHARGE", "REFUND", "ADMIN_ADJUSTMENT"];
    if (q.type && pureLedgerTypes.includes(q.type)) {
      const where = { userId, type: q.type as never };
      const [transactions, total] = await Promise.all([
        fastify.prisma.transaction.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip:    offset,
          take:    q.limit,
        }),
        fastify.prisma.transaction.count({ where }),
      ]);
      return reply.send({
        transactions: transactions.map(normalizeTx),
        total, page: q.page, limit: q.limit,
        totalPages: Math.ceil(total / q.limit),
      });
    }

    // Deposit filters (DEPOSIT_INR / DEPOSIT_USDT) or ALL:
    // Merge Transaction ledger (completed deposits + charges) with
    // DepositRequest non-completed attempts using DB-level UNION ALL + pagination

    // Determine which gateway/methods map to INR vs USDT for DepositRequest filter
    // INR: method IN (MANUAL_INR, RAZORPAY, AUTO) and gateway IN (razorpay, manual_inr)
    // USDT: method IN (MANUAL_USDT) or gateway IN (cryptomus, manual_usdt)

    // Build UNION ALL query using raw SQL for proper DB-side pagination
    // Row shape: id, source, type, status, amount_usd, amount_inr, approx_usd,
    //            description, balance_after, gateway, method, created_at

    let rows: any[];
    let total: number;

    if (q.type === "DEPOSIT_INR" || q.type === "DEPOSIT_USDT") {
      // Tx side: only matching type
      // Deposit side: filter by gateway/method
      const isInr = q.type === "DEPOSIT_INR";

      // Count
      const [txCount, depCount] = await Promise.all([
        fastify.prisma.transaction.count({
          where: { userId, type: q.type as never },
        }),
        fastify.prisma.depositRequest.count({
          where: {
            userId,
            status: { in: ["PENDING", "FAILED", "CANCELLED", "EXPIRED"] as never[] },
            ...(isInr
              ? { gateway: { in: ["razorpay", "manual_inr"] } }
              : { gateway: { in: ["cryptomus", "manual_usdt"] } }),
          },
        }),
      ]);
      total = txCount + depCount;

      // Fetch paginated via UNION ALL raw SQL
      rows = await fastify.prisma.$queryRaw`
        SELECT * FROM (
          SELECT
            t.id,
            'transaction'::text   AS source,
            t.type::text          AS type,
            'COMPLETED'::text     AS status,
            t."amountUsd"::text   AS amount_usd,
            t."amountInr"::text   AS amount_inr,
            NULL::text            AS approx_usd,
            t.description         AS description,
            t."balanceAfter"::text AS balance_after,
            t."orderId"           AS order_id,
            NULL::text            AS gateway,
            NULL::text            AS method,
            t."createdAt"         AS created_at
          FROM transactions t
          WHERE t."userId" = ${userId}
            AND t.type = ${q.type}::\"TransactionType\"
          UNION ALL
          SELECT
            d.id,
            'deposit'::text       AS source,
            ${isInr ? 'DEPOSIT_INR' : 'DEPOSIT_USDT'}::text AS type,
            d.status::text        AS status,
            NULL::text            AS amount_usd,
            d."amountInr"::text   AS amount_inr,
            CASE
              WHEN d."amountUsdt" IS NOT NULL
                THEN d."amountUsdt"::text
              WHEN d."amountInr" IS NOT NULL AND d."inrRateSnapshot" IS NOT NULL
                THEN (d."amountInr" / d."inrRateSnapshot")::text
              ELSE NULL
            END                   AS approx_usd,
            CASE
              WHEN d.method = 'MANUAL_INR'  THEN 'Manual Bank Transfer'
              WHEN d.method = 'MANUAL_USDT' THEN 'Manual USDT Transfer'
              WHEN d.gateway = 'razorpay'   THEN 'Razorpay'
              WHEN d.gateway = 'cryptomus'  THEN 'Cryptomus USDT'
              ELSE 'Payment attempt'
            END                   AS description,
            NULL::text            AS balance_after,
            NULL::text            AS order_id,
            d.gateway             AS gateway,
            d.method              AS method,
            d."createdAt"         AS created_at
          FROM deposit_requests d
          WHERE d."userId" = ${userId}
            AND d.status IN ('PENDING','FAILED','CANCELLED','EXPIRED')
            AND d.gateway IN (${isInr ? 'razorpay' : 'cryptomus'}, ${isInr ? 'manual_inr' : 'manual_usdt'})
        ) combined
        ORDER BY created_at DESC
        LIMIT ${q.limit} OFFSET ${offset}
      `;

    } else {
      // ALL: merge everything
      const [txCount, depCount] = await Promise.all([
        fastify.prisma.transaction.count({ where: { userId } }),
        fastify.prisma.depositRequest.count({
          where: {
            userId,
            status: { in: ["PENDING", "FAILED", "CANCELLED", "EXPIRED"] as never[] },
          },
        }),
      ]);
      total = txCount + depCount;

      rows = await fastify.prisma.$queryRaw`
        SELECT * FROM (
          SELECT
            t.id,
            'transaction'::text   AS source,
            t.type::text          AS type,
            'COMPLETED'::text     AS status,
            t."amountUsd"::text   AS amount_usd,
            t."amountInr"::text   AS amount_inr,
            NULL::text            AS approx_usd,
            t.description         AS description,
            t."balanceAfter"::text AS balance_after,
            t."orderId"           AS order_id,
            NULL::text            AS gateway,
            NULL::text            AS method,
            t."createdAt"         AS created_at
          FROM transactions t
          WHERE t."userId" = ${userId}
          UNION ALL
          SELECT
            d.id,
            'deposit'::text       AS source,
            CASE
              WHEN d.method = 'MANUAL_USDT' OR d.gateway = 'cryptomus'
                THEN 'DEPOSIT_USDT'
              ELSE 'DEPOSIT_INR'
            END                   AS type,
            d.status::text        AS status,
            NULL::text            AS amount_usd,
            d."amountInr"::text   AS amount_inr,
            CASE
              WHEN d."amountUsdt" IS NOT NULL
                THEN d."amountUsdt"::text
              WHEN d."amountInr" IS NOT NULL AND d."inrRateSnapshot" IS NOT NULL
                THEN (d."amountInr" / d."inrRateSnapshot")::text
              ELSE NULL
            END                   AS approx_usd,
            CASE
              WHEN d.method = 'MANUAL_INR'  THEN 'Manual Bank Transfer'
              WHEN d.method = 'MANUAL_USDT' THEN 'Manual USDT Transfer'
              WHEN d.gateway = 'razorpay'   THEN 'Razorpay'
              WHEN d.gateway = 'cryptomus'  THEN 'Cryptomus USDT'
              ELSE 'Payment attempt'
            END                   AS description,
            NULL::text            AS balance_after,
            NULL::text            AS order_id,
            d.gateway             AS gateway,
            d.method              AS method,
            d."createdAt"         AS created_at
          FROM deposit_requests d
          WHERE d."userId" = ${userId}
            AND d.status IN ('PENDING','FAILED','CANCELLED','EXPIRED')
        ) combined
        ORDER BY created_at DESC
        LIMIT ${q.limit} OFFSET ${offset}
      `;
    }

    // Normalise raw SQL rows into unified response shape
    const transactions = (rows as any[]).map((r) => ({
      id:          r.id,
      source:      r.source,
      type:        r.type,
      gateway:     r.gateway ?? null,
      method:      r.method ?? null,
      status:      r.status,
      amountUsd:   r.amount_usd ?? null,
      approxUsd:   r.approx_usd ?? null,
      amountInr:   r.amount_inr ?? null,
      description: r.description,
      balanceAfter: r.balance_after ?? null,
      orderId:     r.order_id ?? null,
      createdAt:   r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at),
    }));

    return reply.send({
      transactions,
      total,
      page:       q.page,
      limit:      q.limit,
      totalPages: Math.ceil(total / q.limit),
    });
  });
}

// ── Pure normalizers (used by ORDER_CHARGE / REFUND / ADMIN_ADJUSTMENT path) ──

function normalizeTx(t: any) {
  return {
    id:          t.id,
    source:      "transaction" as const,
    type:        t.type,
    gateway:     null as string | null,
    method:      null as string | null,
    status:      "COMPLETED",
    amountUsd:   t.amountUsd.toString(),
    approxUsd:   null as string | null,
    amountInr:   t.amountInr?.toString() ?? null,
    description: t.description,
    balanceAfter: t.balanceAfter.toString(),
    orderId:     t.orderId ?? null,
    createdAt:   t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
  };
}