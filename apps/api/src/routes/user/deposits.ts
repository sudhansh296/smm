import type { FastifyInstance } from "fastify";
import { z } from "zod";

export default async function userDepositsRoute(fastify: FastifyInstance) {
  fastify.get("/deposits", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const q = z.object({
      page:  z.coerce.number().min(1).default(1),
      limit: z.coerce.number().min(1).max(50).default(20),
    }).parse(request.query);

    const userId = request.user.sub;
    const skip   = (q.page - 1) * q.limit;

    const [deposits, total] = await Promise.all([
      fastify.prisma.depositRequest.findMany({
        where:   { userId },
        orderBy: { createdAt: "desc" },
        skip,
        take: q.limit,
        select: {
          id:               true,
          gateway:          true,
          method:           true,
          amountInr:        true,
          amountUsdt:       true,
          status:           true,
          gatewayOrderId:   true,
          gatewayPaymentId: true,
          createdAt:        true,
          updatedAt:        true,
        },
      }),
      fastify.prisma.depositRequest.count({ where: { userId } }),
    ]);

    return reply.send({
      deposits: deposits.map((d: any) => ({
        id:               d.id,
        gateway:          d.gateway,
        method:           d.method,
        amountInr:        d.amountInr?.toString() ?? null,
        amountUsdt:       d.amountUsdt?.toString() ?? null,
        status:           d.status,
        gatewayOrderId:   d.gatewayOrderId,
        gatewayPaymentId: d.gatewayPaymentId ?? null,
        createdAt:        d.createdAt.toISOString(),
        updatedAt:        d.updatedAt.toISOString(),
      })),
      total,
      page:       q.page,
      limit:      q.limit,
      totalPages: Math.ceil(total / q.limit),
    });
  });
}