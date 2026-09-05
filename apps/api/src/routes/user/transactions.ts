import type { FastifyInstance } from "fastify";
import { z } from "zod";

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  type: z
    .enum(["DEPOSIT_INR", "DEPOSIT_USDT", "ORDER_CHARGE", "REFUND", "ADMIN_ADJUSTMENT"])
    .optional(),
  dateFrom: z.string().datetime({ message: "Invalid date format (use ISO 8601)" }).optional(),
  dateTo:   z.string().datetime({ message: "Invalid date format (use ISO 8601)" }).optional(),
});

export default async function transactionsRoute(fastify: FastifyInstance) {
  fastify.get(
    "/transactions",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const q = querySchema.parse(request.query);
      const skip = (q.page - 1) * q.limit;
      const userId = request.user.sub;

      const where = {
        userId,
        ...(q.type && { type: q.type }),
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
          orderBy: { createdAt: "desc" },
          skip,
          take: q.limit,
        }),
        fastify.prisma.transaction.count({ where }),
      ]);

      return reply.send({
        transactions: transactions.map((t: {
          id: string; type: string; amountUsd: { toString(): string };
          amountInr: { toString(): string } | null; inrRate: { toString(): string } | null;
          description: string; balanceBefore: { toString(): string };
          balanceAfter: { toString(): string }; orderId: string | null; createdAt: Date;
        }) => ({
          id: t.id,
          type: t.type,
          amountUsd: t.amountUsd.toString(),
          amountInr: t.amountInr?.toString() ?? null,
          inrRate: t.inrRate?.toString() ?? null,
          description: t.description,
          balanceBefore: t.balanceBefore.toString(),
          balanceAfter: t.balanceAfter.toString(),
          orderId: t.orderId,
          createdAt: t.createdAt.toISOString(),
        })),
        total,
        page: q.page,
        limit: q.limit,
        totalPages: Math.ceil(total / q.limit),
      });
    },
  );
}



