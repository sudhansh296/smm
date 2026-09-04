import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";

export default async function adminTransactionsRoute(fastify: FastifyInstance) {
  fastify.get(
    "/transactions",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const q = z
        .object({
          page: z.coerce.number().min(1).default(1),
          limit: z.coerce.number().min(1).max(100).default(20),
          type: z.string().optional(),
          userId: z.string().optional(),
          dateFrom: z.string().optional(),
          dateTo: z.string().optional(),
        })
        .parse(request.query);

      const skip = (q.page - 1) * q.limit;
      const where = {
        ...(q.type && { type: q.type as never }),
        ...(q.userId && { userId: q.userId }),
        ...(q.dateFrom || q.dateTo
          ? {
              createdAt: {
                ...(q.dateFrom && { gte: new Date(q.dateFrom) }),
                ...(q.dateTo && { lte: new Date(q.dateTo) }),
              },
            }
          : {}),
      };

      const [transactions, total] = await Promise.all([
        fastify.prisma.transaction.findMany({
          where,
          skip,
          take: q.limit,
          orderBy: { createdAt: "desc" },
          include: { user: { select: { email: true } } },
        }),
        fastify.prisma.transaction.count({ where }),
      ]);

      // Summary for the filtered range
      const summary = await fastify.prisma.transaction.groupBy({
        by: ["type"],
        where,
        _sum: { amountUsd: true },
      });

      const summaryMap = Object.fromEntries(
        summary.map((s: any) => [s.type, new Decimal(s._sum.amountUsd?.toString() ?? "0")]),
      );

      return reply.send({
        transactions: transactions.map((t: any) => ({
          id: t.id,
          userId: t.userId,
          userEmail: t.user.email,
          type: t.type,
          amountUsd: t.amountUsd.toString(),
          amountInr: t.amountInr?.toString() ?? null,
          description: t.description,
          createdAt: t.createdAt.toISOString(),
        })),
        total,
        page: q.page,
        limit: q.limit,
        totalPages: Math.ceil(total / q.limit),
        summary: {
          totalDepositsUsd: new Decimal(
            (summaryMap["DEPOSIT_INR"] ?? new Decimal(0))
              .plus(summaryMap["DEPOSIT_USDT"] ?? new Decimal(0))
              .toString(),
          ).toFixed(8),
          totalOrderChargesUsd: new Decimal(
            summaryMap["ORDER_CHARGE"]?.abs() ?? new Decimal(0),
          ).toFixed(8),
          totalRefundsUsd: new Decimal(
            summaryMap["REFUND"] ?? new Decimal(0),
          ).toFixed(8),
        },
      });
    },
  );
}

