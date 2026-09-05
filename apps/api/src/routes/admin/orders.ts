import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { ProviderClient } from "../../services/provider.service.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";
import { refundOrderTx } from "../../services/wallet.service.js";

export default async function adminOrdersRoute(fastify: FastifyInstance) {

  // ── List all orders ────────────────────────────────────────────────────────
  fastify.get("/orders", { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const q = z.object({
      page:       z.coerce.number().min(1).default(1),
      limit:      z.coerce.number().min(1).max(100).default(20),
      status:     z.string().optional(),
      userId:     z.string().optional(),
      providerId: z.string().optional(),
      dateFrom:   z.string().optional(),
      dateTo:     z.string().optional(),
    }).parse(request.query);

    const skip = (q.page - 1) * q.limit;
    const where: Record<string, unknown> = {};
    if (q.status)     where["status"]  = q.status;
    if (q.userId)     where["userId"]  = q.userId;
    if (q.providerId) where["service"] = { providerId: q.providerId };
    if (q.dateFrom || q.dateTo) {
      where["createdAt"] = {
        ...(q.dateFrom && { gte: new Date(q.dateFrom) }),
        ...(q.dateTo   && { lte: new Date(q.dateTo) }),
      };
    }

    const [orders, total] = await Promise.all([
      fastify.prisma.order.findMany({
        where: where as never, skip, take: q.limit,
        orderBy: { createdAt: "desc" },
        include: {
          user:    { select: { email: true } },
          service: { select: { name: true, provider: { select: { name: true } } } },
        },
      }),
      fastify.prisma.order.count({ where: where as never }),
    ]);

    return reply.send({
      orders: orders.map((o: any) => ({
        id:                   o.id,
        userId:               o.userId,
        userEmail:            o.user.email,
        serviceName:          o.service.name,
        providerName:         o.service.provider.name,
        link:                 o.link,
        quantity:             o.quantity,
        costUsd:              o.costUsd.toString(),
        status:               o.status,
        providerOrderId:      o.providerOrderId ?? null,
        fulfillmentProviderId: o.fulfillmentProviderId ?? null,
        createdAt:            o.createdAt.toISOString(),
        updatedAt:            o.updatedAt.toISOString(),
      })),
      total, page: q.page, limit: q.limit,
      totalPages: Math.ceil(total / q.limit),
    });
  });

  // ── Manual status update ───────────────────────────────────────────────────
  // CANCELLED and REFUNDED are blocked — they require wallet changes.
  // Use /cancel or /refund endpoints for those.
  fastify.patch(
    "/orders/:id/status",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);

      const { status } = z.object({
        status: z.enum([
          "PENDING",
          "FORWARDING",
          "PROCESSING",
          "IN_PROGRESS",
          "COMPLETED",
          "PARTIAL",
          "CANCEL_REQUESTED",
        ]),
      }).parse(request.body);

      const exists = await fastify.prisma.order.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw new NotFoundError("Order not found");

      await fastify.prisma.order.update({
        where: { id },
        data:  { status: status as never },
      });

      return reply.send({ message: "Status updated" });
    },
  );

  // ── Admin refund ───────────────────────────────────────────────────────────
  fastify.post(
    "/orders/:id/refund",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id }     = z.object({ id: z.string() }).parse(request.params);
      const { reason } = z.object({ reason: z.string().min(1).default("Admin issued refund") }).parse(request.body);

      const order = await fastify.prisma.order.findUnique({
        where:   { id },
        include: { user: { select: { email: true } } },
      }) as any;

      if (!order) throw new NotFoundError("Order not found");
      if (order.status === "REFUNDED" || order.refundedAt) {
        throw new ValidationError("Order has already been refunded");
      }

      const refundAmount = new Decimal(order.costUsd.toString());

      await fastify.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ status: string; refundedAt: Date | null }>>`
          SELECT status, "refundedAt" FROM orders WHERE id = ${id} FOR UPDATE
        `;
        if (!locked[0] || locked[0].status === "REFUNDED" || locked[0].refundedAt !== null) return;

        await tx.order.update({ where: { id }, data: { status: "REFUNDED" } });

        await refundOrderTx(
          tx as Parameters<typeof refundOrderTx>[0],
          id,
          {
            userId:    order.userId,
            amountUsd: refundAmount,
            inrRate:   new Decimal(order.inrRateAtOrder.toString()),
            description: reason,
          },
        );

        await tx.notification.create({
          data: {
            userId:  order.userId,
            message: `Order #${id.slice(-8)} refunded. $${refundAmount.toFixed(2)} added to your wallet.`,
          },
        });
      });

      return reply.send({
        message:       `Refunded $${refundAmount.toFixed(2)} to ${order.user.email}`,
        refundAmount:  refundAmount.toFixed(2),
        orderId:       id,
      });
    },
  );

  // ── Admin sync from provider ───────────────────────────────────────────────
  fastify.post(
    "/orders/:id/sync",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);

      const order = await fastify.prisma.order.findUnique({
        where:   { id },
        include: { service: { include: { provider: true } } },
      }) as any;

      if (!order) throw new NotFoundError("Order not found");
      if (!order.providerOrderId) {
        return reply.send({ message: "No provider order ID — cannot sync" });
      }

      // Use fulfillment provider (may differ from service.provider if backup was used)
      const fulfillmentProviderId = order.fulfillmentProviderId ?? order.service.providerId;
      let provider = order.service.provider;
      if (fulfillmentProviderId !== order.service.providerId) {
        const alt = await fastify.prisma.provider.findUnique({ where: { id: fulfillmentProviderId } });
        if (alt) provider = alt;
      }

      const client = new ProviderClient(provider);
      const providerStatus = await client.getStatus(order.providerOrderId);

      const STATUS_MAP: Record<string, string> = {
        "Pending":     "PENDING",
        "Processing":  "PROCESSING",
        "In progress": "IN_PROGRESS",
        "Completed":   "COMPLETED",
        "Partial":     "PARTIAL",
        "Cancelled":   "CANCELLED",
        "Canceled":    "CANCELLED",
      };

      const mappedStatus  = providerStatus.status ? STATUS_MAP[providerStatus.status] ?? null : null;
      const newRemains    = providerStatus.remains    ?? order.remains    ?? 0;
      const newStartCount = providerStatus.start_count ?? order.startCount;

      // No status change — just update counters
      if (!mappedStatus || mappedStatus === order.status) {
        await fastify.prisma.order.update({
          where: { id },
          data:  { startCount: newStartCount, remains: newRemains },
        });
        return reply.send({ providerStatus, localStatusUpdated: null, message: "Counters synced", provider: provider.name });
      }

      // Status changed — apply refund if PARTIAL/CANCELLED with undelivered units
      const REFUND_ON = new Set(["PARTIAL", "CANCELLED"]);
      if (REFUND_ON.has(mappedStatus) && newRemains > 0 && !order.refundedAt) {
        const totalCost    = new Decimal(order.costUsd.toString());
        const refundRatio  = new Decimal(newRemains).dividedBy(order.quantity);
        const refundAmount = totalCost.times(refundRatio).toDecimalPlaces(8);

        if (refundAmount.greaterThan(0)) {
          await fastify.prisma.$transaction(async (tx) => {
            await tx.order.update({
              where: { id },
              data:  { status: mappedStatus as never, startCount: newStartCount, remains: newRemains },
            });
            try {
              await refundOrderTx(tx as Parameters<typeof refundOrderTx>[0], id, {
                userId:      order.userId,
                amountUsd:   refundAmount,
                inrRate:     new Decimal(order.inrRateAtOrder.toString()),
                description: `Admin sync refund: ${newRemains} units undelivered`,
              });
            } catch { /* already refunded — skip */ }
          });

          return reply.send({
            providerStatus,
            localStatusUpdated: mappedStatus,
            refundIssued:       refundAmount.toFixed(2),
            message:            "Status synced + partial refund issued",
            provider:           provider.name,
          });
        }
      }

      // Status changed, no refund needed
      await fastify.prisma.order.update({
        where: { id },
        data:  { status: mappedStatus as never, startCount: newStartCount, remains: newRemains },
      });

      return reply.send({
        providerStatus,
        localStatusUpdated: mappedStatus,
        message:            "Status synced",
        provider:           provider.name,
      });
    },
  );
}