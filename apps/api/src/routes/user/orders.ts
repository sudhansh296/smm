import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { NotFoundError, ForbiddenError, ValidationError } from "../../lib/errors.js";
import { ProviderClient } from "../../services/provider.service.js";
import { refundOrderTx } from "../../services/wallet.service.js";

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(["PENDING","FORWARDING","PROCESSING","IN_PROGRESS","COMPLETED","PARTIAL",
    "CANCEL_REQUESTED","CANCELLED","REFUNDED"]).optional(),
});

export default async function userOrdersRoute(fastify: FastifyInstance) {
  fastify.get("/orders", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const q = querySchema.parse(request.query);
    const skip = (q.page - 1) * q.limit;
    const userId = request.user.sub;
    const where = { userId, ...(q.status && { status: q.status as never }) };

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
        supportsRefill: o.service.supportsRefill, refillRequestedAt: o.refillRequestedAt?.toISOString() ?? null,
        refillStatus: o.refillStatus, createdAt: o.createdAt.toISOString(), updatedAt: o.updatedAt.toISOString(),
      })),
      total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit),
    });
  });

  // Cancel order — Fix 2: two-phase cancellation
  // PENDING orders: can cancel + refund immediately (provider never got the order)
  // PROCESSING orders with providerOrderId: set CANCEL_REQUESTED, try provider cancel,
  //   only refund after provider confirms cancellation
  fastify.post("/orders/:id/cancel", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const userId = request.user.sub;

    const order = await fastify.prisma.order.findUnique({
      where: { id },
      include: { service: { include: { provider: true } } },
    }) as any;

    if (!order || order.userId !== userId) throw new NotFoundError("Order not found");

    const cancelableStatuses = ["PENDING", "FORWARDING", "PROCESSING", "IN_PROGRESS", "CANCEL_REQUESTED"];
    if (!cancelableStatuses.includes(order.status)) {
      throw new ValidationError("This order cannot be cancelled");
    }

    // Already in cancel flow
    if (order.status === "CANCEL_REQUESTED") {
      return reply.send({ message: "Cancellation already in progress", status: "CANCEL_REQUESTED" });
    }

    // PENDING or FORWARDING — provider never got the order (or we don't know)
    // For FORWARDING: we don't know if provider got it — treat as CANCEL_REQUESTED to be safe
    if (["PENDING", "FORWARDING"].includes(order.status)) {
      await fastify.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ status: string }>>`
          SELECT status FROM orders WHERE id = ${id} FOR UPDATE
        `;
        if (!locked[0] || !["PENDING", "FORWARDING"].includes(locked[0].status)) return;

        await tx.order.update({ where: { id }, data: { status: "CANCELLED" } });

        await refundOrderTx(
          tx as Parameters<typeof refundOrderTx>[0],
          id,
          {
            userId,
            amountUsd: new Decimal(order.costUsd.toString()),
            inrRate: new Decimal(order.inrRateAtOrder.toString()),
            description: `Refund: order #${id.slice(-8)} cancelled (not yet sent to provider)`,
          },
        );
        await tx.notification.create({
          data: { userId, message: `Order #${id.slice(-8)} cancelled. $${new Decimal(order.costUsd.toString()).toFixed(2)} refunded.` },
        });
      });
      return reply.send({ message: "Order cancelled and refunded" });
    }

    // PROCESSING / IN_PROGRESS — provider has the order
    // Set CANCEL_REQUESTED first, then try provider cancel
    if (!order.providerOrderId) {
      // No providerOrderId but PROCESSING — safe to cancel and refund immediately
      await fastify.prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id }, data: { status: "CANCELLED" } });
        await refundOrderTx(tx as Parameters<typeof refundOrderTx>[0], id, {
          userId,
          amountUsd: new Decimal(order.costUsd.toString()),
          inrRate: new Decimal(order.inrRateAtOrder.toString()),
          description: `Refund: order #${id.slice(-8)} cancelled`,
        });
        await tx.notification.create({
          data: { userId, message: `Order #${id.slice(-8)} cancelled. $${new Decimal(order.costUsd.toString()).toFixed(2)} refunded.` },
        });
      });
      return reply.send({ message: "Order cancelled and refunded" });
    }

    // Has providerOrderId — must confirm with provider before refunding
    // Step 1: mark CANCEL_REQUESTED atomically
    const marked = await fastify.prisma.order.updateMany({
      where: { id, status: order.status, userId },
      data: { status: "CANCEL_REQUESTED" } as never,
    });
    if (marked.count === 0) {
      throw new ValidationError("Order status changed — please try again");
    }

    // Step 2: attempt provider cancel
    const providerId = order.fulfillmentProviderId ?? order.service.providerId;
    let provider = order.service.provider;
    if (providerId !== order.service.providerId) {
      const alt = await fastify.prisma.provider.findUnique({ where: { id: providerId } });
      if (alt) provider = alt;
    }

    let providerCancelled = false;
    try {
      const client = new ProviderClient(provider);
      await client.cancelOrder(order.providerOrderId);
      providerCancelled = true;
    } catch (err) {
      fastify.log.warn({ err, orderId: id }, "Provider cancel request failed");
    }

    if (providerCancelled) {
      // Provider confirmed — now safe to refund
      await fastify.prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id }, data: { status: "CANCELLED" } });
        await refundOrderTx(tx as Parameters<typeof refundOrderTx>[0], id, {
          userId,
          amountUsd: new Decimal(order.costUsd.toString()),
          inrRate: new Decimal(order.inrRateAtOrder.toString()),
          description: `Refund: order #${id.slice(-8)} cancelled (provider confirmed)`,
        });
        await tx.notification.create({
          data: { userId, message: `Order #${id.slice(-8)} cancelled. $${new Decimal(order.costUsd.toString()).toFixed(2)} refunded.` },
        });
      });
      return reply.send({ message: "Order cancelled and refunded" });
    } else {
      // Provider cancel failed — order stays CANCEL_REQUESTED
      // Admin will process manually; status-poll worker may also pick it up
      return reply.send({
        message: "Cancellation requested. Waiting for provider confirmation. Refund will be issued once confirmed.",
        status: "CANCEL_REQUESTED",
      });
    }
  });

  // Request refill
  fastify.post("/orders/:id/refill", { preHandler: [fastify.authenticate] }, async (request, reply) => {
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