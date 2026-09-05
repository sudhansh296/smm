import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { NotFoundError, ForbiddenError, ValidationError } from "../../lib/errors.js";
import { cancelOrder } from "../../services/cancel.service.js";

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.string().optional(),
});

export default async function userOrdersRoute(fastify: FastifyInstance) {
  fastify.get("/orders", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const q = querySchema.parse(request.query);
    const skip = (q.page - 1) * q.limit;
    const userId = request.user.sub;
    const where = { userId, ...(q.status && q.status !== "ALL" && { status: q.status as never }) };

    const [orders, total] = await Promise.all([
      fastify.prisma.order.findMany({
        where, orderBy: { createdAt: "desc" }, skip, take: q.limit,
        include: { service: { select: { name: true, supportsRefill: true, category: { select: { name: true } } } } },
      }),
      fastify.prisma.order.count({ where }),
    ]);

    return reply.send({
      orders: orders.map((o: any) => ({
        id: o.id, serviceId: o.serviceId, serviceName: o.service.name,
        categoryName: o.service.category.name, link: o.link, quantity: o.quantity,
        costUsd: o.costUsd.toString(),
        costInr: new Decimal(o.costUsd.toString()).times(o.inrRateAtOrder.toString()).toFixed(2),
        inrRateAtOrder: o.inrRateAtOrder.toString(), status: o.status,
        providerOrderId: o.providerOrderId, startCount: o.startCount, remains: o.remains,
        supportsRefill: o.service.supportsRefill,
        refillRequestedAt: o.refillRequestedAt?.toISOString() ?? null,
        refillStatus: o.refillStatus,
        createdAt: o.createdAt.toISOString(), updatedAt: o.updatedAt.toISOString(),
      })),
      total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit),
    });
  });

  // Cancel — delegates to shared cancel.service (fixes #1 FORWARDING, #2 provider response check)
  fastify.post("/orders/:id/cancel", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const result = await cancelOrder(fastify.prisma, id, request.user.sub, false);
    return reply.send({ message: result.message, status: result.status });
  });

  // Request refill
  fastify.post("/orders/:id/refill", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const userId = request.user.sub;

    const order = await fastify.prisma.order.findUnique({ where: { id }, include: { service: true } });

    if (!order || order.userId !== userId) throw new NotFoundError("Order not found");
    if (!["COMPLETED", "PARTIAL"].includes(order.status)) {
      throw new ValidationError("Only COMPLETED or PARTIAL orders can be refilled");
    }
    if (!order.service.supportsRefill) throw new ForbiddenError("This service does not support refill");

    const updated = await fastify.prisma.order.updateMany({
      where: {
        id, userId,
        status: { in: ["COMPLETED", "PARTIAL"] } as never,
        refillStatus: { notIn: ["pending", "processing"] },
      },
      data: { refillRequestedAt: new Date(), refillStatus: "pending" },
    });

    if (updated.count === 0) {
      throw new ValidationError("A refill is already in progress for this order");
    }

    const bucket = Math.floor(Date.now() / (5 * 60 * 1000));
    await fastify.queues.refill.add("refill", { orderId: id }, {
      jobId: `refill:${id}:${bucket}`,
      removeOnComplete: true,
      removeOnFail: true,
    });

    return reply.send({ message: "Refill requested" });
  });
}