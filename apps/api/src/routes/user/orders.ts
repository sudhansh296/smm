import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { NotFoundError, ForbiddenError, ValidationError } from "../../lib/errors.js";
import { ProviderClient } from "../../services/provider.service.js";

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z
    .enum(["PENDING", "PROCESSING", "IN_PROGRESS", "COMPLETED", "PARTIAL", "CANCELLED", "REFUNDED"])
    .optional(),
});

export default async function userOrdersRoute(fastify: FastifyInstance) {
  // Order history
  fastify.get(
    "/orders",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const q = querySchema.parse(request.query);
      const skip = (q.page - 1) * q.limit;
      const userId = request.user.sub;

      const where = { userId, ...(q.status && { status: q.status }) };

      const [orders, total] = await Promise.all([
        fastify.prisma.order.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: q.limit,
          include: {
            service: {
              select: {
                name: true,
                supportsRefill: true,
                category: { select: { name: true } },
              },
            },
          },
        }),
        fastify.prisma.order.count({ where }),
      ]);

      return reply.send({
        orders: orders.map((o: any) => ({
          id: o.id,
          serviceId: o.serviceId,
          serviceName: o.service.name,
          categoryName: o.service.category.name,
          link: o.link,
          quantity: o.quantity,
          costUsd: o.costUsd.toString(),
          costInr: new Decimal(o.costUsd.toString())
            .times(o.inrRateAtOrder.toString())
            .toFixed(2),
          inrRateAtOrder: o.inrRateAtOrder.toString(),
          status: o.status,
          providerOrderId: o.providerOrderId,
          startCount: o.startCount,
          remains: o.remains,
          supportsRefill: o.service.supportsRefill,
          refillRequestedAt: o.refillRequestedAt?.toISOString() ?? null,
          refillStatus: o.refillStatus,
          createdAt: o.createdAt.toISOString(),
          updatedAt: o.updatedAt.toISOString(),
        })),
        total,
        page: q.page,
        limit: q.limit,
        totalPages: Math.ceil(total / q.limit),
      });
    },
  );

  // Cancel order
  fastify.post(
    "/orders/:id/cancel",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const userId = request.user.sub;

      const order = await fastify.prisma.order.findUnique({
        where: { id },
        include: {
          service: { include: { provider: true } },
        },
      });

      if (!order || order.userId !== userId) throw new NotFoundError("Order not found");
      if (!["PENDING", "PROCESSING"].includes(order.status)) {
        throw new ValidationError("Only PENDING or PROCESSING orders can be cancelled");
      }

      // Ask provider to cancel
      if (order.providerOrderId) {
        try {
          const client = new ProviderClient(order.service.provider);
          await client.cancelOrder(order.providerOrderId);
        } catch (err) {
          fastify.log.warn({ err, orderId: id }, "Provider cancel request failed");
        }
      }

      await fastify.prisma.order.update({
        where: { id },
        data: { status: "CANCELLED" },
      });

      return reply.send({ message: "Cancellation requested" });
    },
  );

  // Request refill
  fastify.post(
    "/orders/:id/refill",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const userId = request.user.sub;

      const order = await fastify.prisma.order.findUnique({
        where: { id },
        include: { service: true },
      });

      if (!order || order.userId !== userId) throw new NotFoundError("Order not found");
      if (!["COMPLETED", "PARTIAL"].includes(order.status)) {
        throw new ValidationError("Only COMPLETED or PARTIAL orders can be refilled");
      }
      if (!order.service.supportsRefill) {
        throw new ForbiddenError("This service does not support refill");
      }

      await fastify.prisma.order.update({
        where: { id },
        data: { refillRequestedAt: new Date(), refillStatus: "pending" },
      });

      // Enqueue refill job
      const queues = fastify.queues;
      await queues.refill.add("refill", { orderId: id });

      return reply.send({ message: "Refill requested" });
    },
  );
}




