import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { ProviderClient } from "../../services/provider.service.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";
import { creditWalletTx } from "../../services/wallet.service.js";

export default async function adminOrdersRoute(fastify: FastifyInstance) {
  // List all orders
  fastify.get("/orders", { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const q = z.object({
      page: z.coerce.number().min(1).default(1),
      limit: z.coerce.number().min(1).max(100).default(20),
      status: z.string().optional(),
      userId: z.string().optional(),
      providerId: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }).parse(request.query);

    const skip = (q.page - 1) * q.limit;
    const where = {
      ...(q.status && { status: q.status as never }),
      ...(q.userId && { userId: q.userId }),
      ...(q.providerId && { service: { providerId: q.providerId } }),
      ...(q.dateFrom || q.dateTo ? {
        createdAt: {
          ...(q.dateFrom && { gte: new Date(q.dateFrom) }),
          ...(q.dateTo && { lte: new Date(q.dateTo) }),
        },
      } : {}),
    };

    const [orders, total] = await Promise.all([
      fastify.prisma.order.findMany({
        where, skip, take: q.limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { email: true } },
          service: { select: { name: true, provider: { select: { name: true } } } },
        },
      }),
      fastify.prisma.order.count({ where }),
    ]);

    return reply.send({
      orders: orders.map((o: any) => ({
        id: o.id, userId: o.userId, userEmail: o.user.email,
        serviceName: o.service.name, providerName: o.service.provider.name,
        link: o.link, quantity: o.quantity, costUsd: o.costUsd.toString(),
        status: o.status, providerOrderId: o.providerOrderId,
        fulfillmentProviderId: (o as any).fulfillmentProviderId ?? null,
        createdAt: o.createdAt.toISOString(), updatedAt: o.updatedAt.toISOString(),
      })),
      total, page: q.page, limit: q.limit,
      totalPages: Math.ceil(total / q.limit),
    });
  });

  // Manual status update — does NOT credit wallet (use /refund for that)
  // Prevents accidental cancellation without refund
  fastify.patch(
    "/orders/:id/status",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const { status } = z.object({
        status: z.enum(["PENDING","PROCESSING","IN_PROGRESS","COMPLETED","PARTIAL","CANCELLED","REFUNDED"]),
      }).parse(request.body);

      // Warn: setting CANCELLED/REFUNDED via status patch does NOT refund wallet
      // Use POST /admin/orders/:id/refund for wallet-crediting refunds
      await fastify.prisma.order.update({ where: { id }, data: { status } });
      return reply.send({
        message: "Status updated",
        note: ["CANCELLED","REFUNDED"].includes(status)
          ? "Status changed without wallet credit. Use /refund endpoint if wallet credit is needed."
          : undefined,
      });
    },
  );

  // Admin refund — idempotent, race-condition safe
  fastify.post(
    "/orders/:id/refund",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const { reason } = z.object({ reason: z.string().min(1).default("Admin issued refund") }).parse(request.body);

      const order = await fastify.prisma.order.findUnique({
        where: { id },
        include: { user: { select: { email: true } } },
      });

      if (!order) throw new NotFoundError("Order not found");
      if (order.status === "REFUNDED") throw new ValidationError("Order is already refunded");

      const refundAmount = new Decimal(order.costUsd.toString());
      // Idempotency key — unique per order prevents double-refund even under concurrent requests
      const idempotencyKey = `admin-refund:${id}`;

      await fastify.prisma.$transaction(async (tx) => {
        // Double-check inside transaction with row lock — prevents race condition
        const locked = await tx.$queryRaw<Array<{ status: string }>>`
          SELECT status FROM orders WHERE id = ${id} FOR UPDATE
        `;
        if (!locked[0] || locked[0].status === "REFUNDED") return; // Already refunded

        await tx.order.update({ where: { id }, data: { status: "REFUNDED" } });

        // creditWalletTx — no nested transaction
        await creditWalletTx(
          tx as Parameters<typeof creditWalletTx>[0],
          order.userId,
          refundAmount,
          {
            type: "REFUND",
            description: reason,
            orderId: id,
            inrRate: new Decimal(order.inrRateAtOrder.toString()),
            // Unique key prevents duplicate ledger entries (unique constraint in DB)
            paymentGatewayId: idempotencyKey,
          },
        );

        await tx.notification.create({
          data: {
            userId: order.userId,
            message: `Order #${id.slice(-8)} refunded. $${refundAmount.toFixed(2)} added to your wallet.`,
          },
        });
      });

      return reply.send({
        message: `Refunded $${refundAmount.toFixed(2)} to ${order.user.email}`,
        refundAmount: refundAmount.toFixed(2),
        orderId: id,
      });
    },
  );

  // Sync order status from the ACTUAL fulfillment provider
  fastify.post(
    "/orders/:id/sync",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);

      const order = await fastify.prisma.order.findUnique({
        where: { id },
        include: { service: { include: { provider: true } } },
      }) as any;

      if (!order) throw new NotFoundError("Order not found");
      if (!order.providerOrderId) {
        return reply.send({ message: "No provider order ID — cannot sync" });
      }

      // Use fulfillmentProviderId if available (backup may have handled this order)
      const fulfillmentProviderId = order.fulfillmentProviderId ?? order.service.providerId;
      let provider = order.service.provider;

      if (fulfillmentProviderId !== order.service.providerId) {
        const altProvider = await fastify.prisma.provider.findUnique({ where: { id: fulfillmentProviderId } });
        if (altProvider) provider = altProvider;
      }

      const client = new ProviderClient(provider);
      const status = await client.getStatus(order.providerOrderId);

      await fastify.prisma.order.update({
        where: { id },
        data: {
          startCount: status.start_count ?? order.startCount,
          remains: status.remains ?? order.remains,
        },
      });

      return reply.send({ status, message: "Status synced", provider: provider.name });
    },
  );
}