import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { ProviderClient } from "../../services/provider.service.js";
import { NotFoundError, ValidationError, AlreadyRefundedError } from "../../lib/errors.js";
import { refundOrderTx } from "../../services/wallet.service.js";

function calcSyncRefund(costUsd: string, quantity: number, remains: number): Decimal {
  const total = new Decimal(costUsd);
  const clampedRemains = Math.min(remains, quantity);
  if (clampedRemains <= 0)        return new Decimal(0);
  if (clampedRemains >= quantity) return total;
  return total.times(new Decimal(clampedRemains).dividedBy(quantity)).toDecimalPlaces(8);
}

export default async function adminOrdersRoute(fastify: FastifyInstance) {

  // -- List all orders -------------------------------------------------------
  fastify.get("/orders", { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const q = z.object({
      page:       z.coerce.number().min(1).default(1),
      limit:      z.coerce.number().min(1).max(100).default(20),
      status:     z.string().optional(),
      userId:     z.string().optional(),
      providerId: z.string().optional(),
      dateFrom:   z.string().datetime({ message: "Invalid date" }).optional(),
      dateTo:     z.string().datetime({ message: "Invalid date" }).optional(),
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
        id:                    o.id,
        userId:                o.userId,
        userEmail:             o.user.email,
        serviceName:           o.service.name,
        providerName:          o.service.provider.name,
        link:                  o.link,
        quantity:              o.quantity,
        costUsd:               o.costUsd.toString(),
        status:                o.status,
        providerOrderId:       o.providerOrderId ?? null,
        fulfillmentProviderId: o.fulfillmentProviderId ?? null,
        refundStatus:          o.refundStatus ?? null,
        refundNote:            o.refundNote ?? null,
        refundedAt:            o.refundedAt?.toISOString() ?? null,
        refundedAmountUsd:     o.refundedAmountUsd?.toString() ?? null,
        createdAt:             o.createdAt.toISOString(),
        updatedAt:             o.updatedAt.toISOString(),
      })),
      total, page: q.page, limit: q.limit,
      totalPages: Math.ceil(total / q.limit),
    });
  });

  // -- Manual status update --------------------------------------------------
  fastify.patch(
    "/orders/:id/status",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const { status } = z.object({
        status: z.enum(["PENDING", "PROCESSING", "IN_PROGRESS", "COMPLETED"]),
      }).parse(request.body);

      const exists = await fastify.prisma.order.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw new NotFoundError("Order not found");

      await fastify.prisma.order.update({ where: { id }, data: { status: status as never } });
      return reply.send({ message: "Status updated" });
    },
  );

  // -- Step 1: Initiate refund (sets REFUND_PENDING, no wallet credit yet) ---
  fastify.post(
    "/orders/:id/refund",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id }   = z.object({ id: z.string() }).parse(request.params);
      const { note } = z.object({ note: z.string().min(1).default("Admin initiated refund") }).parse(request.body);

      const order = await fastify.prisma.order.findUnique({
        where:   { id },
        include: { user: { select: { email: true } } },
      }) as any;

      if (!order) throw new NotFoundError("Order not found");

      // Already fully refunded
      if (order.status === "REFUNDED" || order.refundedAt) {
        throw new ValidationError("Order has already been refunded");
      }
      // Already in pending refund workflow
      if (order.refundStatus === "REFUND_PENDING") {
        throw new ValidationError("Refund is already pending approval");
      }
      // Cancelled refund can be re-initiated
      // Any other state: allow initiation

      await fastify.prisma.order.update({
        where: { id },
        data: {
          refundStatus: "REFUND_PENDING" as never,
          refundNote:   note,
        } as never,
      });

      return reply.send({
        message:  "Refund initiated. Approve or cancel from the order actions.",
        orderId:  id,
        refundStatus: "REFUND_PENDING",
        amount:   new Decimal(order.costUsd.toString()).toFixed(2),
      });
    },
  );

  // -- Step 2a: Approve refund (actually credits wallet) ---------------------
  fastify.post(
    "/orders/:id/refund/approve",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);

      const order = await fastify.prisma.order.findUnique({
        where:   { id },
        include: { user: { select: { email: true } } },
      }) as any;

      if (!order) throw new NotFoundError("Order not found");
      if (order.refundStatus !== "REFUND_PENDING") {
        throw new ValidationError("No pending refund to approve. Initiate refund first.");
      }
      if (order.refundedAt) {
        throw new ValidationError("Order has already been refunded");
      }

      const refundAmount = new Decimal(order.costUsd.toString());

      await fastify.prisma.$transaction(async (tx) => {
        // Row lock + double-check state
        const locked = await tx.$queryRaw<Array<{ refundStatus: string | null; refundedAt: Date | null }>>`
          SELECT "refundStatus", "refundedAt" FROM orders WHERE id = ${id} FOR UPDATE
        `;
        if (!locked[0]) throw new NotFoundError("Order not found");
        if (locked[0].refundedAt) throw new ValidationError("Already refunded");
        if (locked[0].refundStatus !== "REFUND_PENDING") {
          throw new ValidationError("Refund is no longer pending");
        }

        // Mark order as REFUNDED + REFUND_APPROVED
        await tx.order.update({
          where: { id },
          data: {
            status:       "REFUNDED" as never,
            refundStatus: "REFUND_APPROVED" as never,
          } as never,
        });

        // Credit wallet
        await refundOrderTx(
          tx as Parameters<typeof refundOrderTx>[0],
          id,
          {
            userId:      order.userId,
            amountUsd:   refundAmount,
            inrRate:     new Decimal(order.inrRateAtOrder.toString()),
            description: order.refundNote ?? "Admin approved refund",
          },
        );

        await tx.notification.create({
          data: {
            userId:  order.userId,
            message: `Your refund of $${refundAmount.toFixed(2)} for order #${id.slice(-8)} has been approved and credited to your wallet.`,
          },
        });
      });

      return reply.send({
        message:      `Refund approved. $${refundAmount.toFixed(2)} credited to ${order.user.email}`,
        refundAmount: refundAmount.toFixed(2),
        orderId:      id,
        refundStatus: "REFUND_APPROVED",
      });
    },
  );

  // -- Step 2b: Cancel refund (no wallet credit, clears pending state) -------
  fastify.post(
    "/orders/:id/refund/cancel",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);

      const order = await fastify.prisma.order.findUnique({
        where: { id },
        select: { id: true, status: true, refundStatus: true, refundedAt: true },
      }) as any;

      if (!order) throw new NotFoundError("Order not found");

      // Cannot cancel if wallet already credited
      if (order.refundedAt || order.status === "REFUNDED") {
        throw new ValidationError("Refund already completed and wallet credited. Use Reverse Refund to undo.");
      }
      if (order.refundStatus !== "REFUND_PENDING") {
        throw new ValidationError("No pending refund to cancel.");
      }

      await fastify.prisma.order.update({
        where: { id },
        data: {
          refundStatus: "REFUND_CANCELLED" as never,
          refundNote:   null,
        } as never,
      });

      return reply.send({
        message:      "Refund cancelled. No wallet credit was issued.",
        orderId:      id,
        refundStatus: "REFUND_CANCELLED",
      });
    },
  );

  // -- Sync from provider ----------------------------------------------------
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
        return reply.send({ message: "No provider order ID -- cannot sync" });
      }

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
      const rawRemains    = providerStatus.remains ?? order.remains ?? 0;
      const newRemains    = Math.max(0, Math.min(rawRemains, order.quantity));
      const newStartCount = providerStatus.start_count ?? order.startCount;

      if (!mappedStatus || mappedStatus === order.status) {
        await fastify.prisma.order.update({
          where: { id },
          data:  { startCount: newStartCount, remains: newRemains },
        });
        return reply.send({ providerStatus, localStatusUpdated: null, message: "Counters synced", provider: provider.name });
      }

      const REFUND_ON = new Set(["PARTIAL", "CANCELLED"]);
      if (REFUND_ON.has(mappedStatus) && !order.refundedAt) {
        const refundAmount = calcSyncRefund(order.costUsd.toString(), order.quantity, newRemains);

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
            } catch (err) {
              if (err instanceof AlreadyRefundedError) {
                fastify.log.info({ orderId: id }, "Admin sync: already refunded -- skipping");
              } else { throw err; }
            }
          });

          return reply.send({
            providerStatus, localStatusUpdated: mappedStatus,
            refundIssued: refundAmount.toFixed(2),
            message: "Status synced + partial refund issued",
            provider: provider.name,
          });
        }
      }

      await fastify.prisma.order.update({
        where: { id },
        data:  { status: mappedStatus as never, startCount: newStartCount, remains: newRemains },
      });

      return reply.send({
        providerStatus, localStatusUpdated: mappedStatus,
        message: "Status synced", provider: provider.name,
      });
    },
  );
}