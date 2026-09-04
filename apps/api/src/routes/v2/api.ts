import type { FastifyInstance } from "fastify";
import { createHash } from "crypto";
import { Decimal } from "decimal.js";
import { z } from "zod";
import { createOrder } from "../../services/order.service.js";
import { creditWalletTx } from "../../services/wallet.service.js";
import { ProviderClient } from "../../services/provider.service.js";

const API_V2_RATE_LIMIT_MAX = 60;
const API_V2_RATE_WINDOW = 60_000;

// Validate link is a real URL — prevents garbage reaching provider
const linkSchema = z.string().url("Must be a valid URL").max(500);

async function validateApiKey(fastify: FastifyInstance, key: string) {
  if (!key) return null;
  const keyHash = createHash("sha256").update(key).digest("hex");
  const apiKey = await fastify.prisma.apiKey.findUnique({
    where: { keyHash },
    include: { user: true },
  });
  if (!apiKey || apiKey.revokedAt) return null;
  return apiKey.user;
}

export default async function apiV2Route(fastify: FastifyInstance) {
  fastify.post("/api/v2", {
    config: {
      rateLimit: {
        max: API_V2_RATE_LIMIT_MAX,
        timeWindow: API_V2_RATE_WINDOW,
        keyGenerator: (req) => {
          const body = req.body as Record<string, string>;
          const key = body?.["key"] ?? "";
          return `apiv2:${key ? createHash("sha256").update(key).digest("hex").slice(0, 16) : req.ip}`;
        },
        errorResponseBuilder: () => ({ error: "Rate limit exceeded. Max 60 requests per minute." }),
      },
    },
  }, async (request, reply) => {
    const body = request.body as Record<string, string>;
    const { key, action, ...params } = body;

    const user = await validateApiKey(fastify, key ?? "");
    if (!user) return reply.status(401).send({ error: "Invalid API key" });
    if (user.isSuspended) return reply.status(403).send({ error: "Account suspended" });

    switch (action) {
      case "services": {
        const services = await fastify.prisma.service.findMany({
          where: { isEnabled: true },
          include: { category: { select: { name: true } } },
          orderBy: { displayOrder: "asc" },
        });
        return reply.send(services.map((s: any) => ({
          service: s.id, name: s.name, type: "Default", category: s.category.name,
          rate: new Decimal(s.sellingPriceUsd.toString()).times(1000).toFixed(4),
          min: s.minQuantity, max: s.maxQuantity, refill: s.supportsRefill, cancel: true,
        })));
      }

      case "add": {
        const serviceId = params["service"];
        const link = params["link"];
        const quantity = parseInt(params["quantity"] ?? "0", 10);

        if (!serviceId || !link || !quantity) {
          return reply.status(400).send({ error: "Missing required parameters: service, link, quantity" });
        }

        // Validate URL server-side — not just frontend
        const linkParsed = linkSchema.safeParse(link);
        if (!linkParsed.success) {
          return reply.status(400).send({ error: "Invalid link: must be a valid URL" });
        }

        try {
          const result = await createOrder(fastify.prisma, fastify.redis, fastify.queues, user.id, serviceId, link, quantity);
          return reply.send({ order: result.orderId });
        } catch (err: unknown) {
          return reply.status(400).send({ error: err instanceof Error ? err.message : "Order failed" });
        }
      }

      case "status": {
        const orderId = params["order"];
        if (!orderId) return reply.status(400).send({ error: "Missing order parameter" });
        const order = await fastify.prisma.order.findFirst({ where: { id: orderId, userId: user.id } });
        if (!order) return reply.status(404).send({ error: "Order not found" });
        return reply.send({
          charge: new Decimal(order.costUsd.toString()).toFixed(8),
          start_count: order.startCount ?? 0,
          status: order.status, remains: order.remains ?? 0, currency: "USD",
        });
      }

      case "multi_status": {
        const orderIds = params["orders"]?.split(",").slice(0, 100) ?? [];
        if (!orderIds.length) return reply.status(400).send({ error: "Missing orders parameter" });
        const orders = await fastify.prisma.order.findMany({ where: { id: { in: orderIds }, userId: user.id } });
        const result: Record<string, object> = {};
        for (const id of orderIds) {
          const o = orders.find((x: { id: string }) => x.id === id);
          result[id] = o
            ? { charge: new Decimal(o.costUsd.toString()).toFixed(8), start_count: o.startCount ?? 0, status: o.status, remains: o.remains ?? 0, currency: "USD" }
            : { error: "Incorrect order ID" };
        }
        return reply.send(result);
      }

      case "refill": {
        const orderId = params["order"];
        if (!orderId) return reply.status(400).send({ error: "Missing order parameter" });
        const order = await fastify.prisma.order.findFirst({ where: { id: orderId, userId: user.id }, include: { service: true } });
        if (!order) return reply.status(404).send({ error: "Order not found" });
        if (!order.service.supportsRefill) return reply.status(400).send({ error: "Service does not support refill" });
        if (order.refillStatus === "pending" || order.refillStatus === "processing") {
          return reply.status(400).send({ error: "A refill is already in progress" });
        }
        await fastify.prisma.order.update({ where: { id: orderId }, data: { refillRequestedAt: new Date(), refillStatus: "pending" } });
        await fastify.queues.refill.add("refill", { orderId }, { jobId: `refill:${orderId}:${Date.now()}` });
        return reply.send({ refill: orderId });
      }

      case "refill_status": {
        const orderId = params["refill"];
        if (!orderId) return reply.status(400).send({ error: "Missing refill parameter" });
        const order = await fastify.prisma.order.findFirst({ where: { id: orderId, userId: user.id } });
        if (!order) return reply.status(404).send({ error: "Refill not found" });
        return reply.send({ status: order.refillStatus ?? "Completed" });
      }

      case "cancel": {
        const orderIds = params["orders"]?.split(",").slice(0, 100) ?? [];
        if (!orderIds.length) return reply.status(400).send({ error: "Missing orders parameter" });

        const results = await Promise.all(orderIds.map(async (orderId) => {
          const order = await fastify.prisma.order.findFirst({
            where: { id: orderId, userId: user.id },
            include: { service: { include: { provider: true } } },
          }) as any;

          if (!order) return { order: orderId, cancel: { error: "Order not found" } };
          if (!["PENDING", "PROCESSING"].includes(order.status)) {
            return { order: orderId, cancel: { error: "Cannot cancel this order" } };
          }

          // Idempotency key per order — prevents double refund under concurrent requests
          const idempotencyKey = `cancel:${orderId}`;

          try {
            await fastify.prisma.$transaction(async (tx) => {
              // Row-lock to prevent race condition
              const locked = await tx.$queryRaw<Array<{ status: string }>>`
                SELECT status FROM orders WHERE id = ${orderId} FOR UPDATE
              `;
              if (!locked[0] || !["PENDING", "PROCESSING"].includes(locked[0].status)) return;

              await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });

              await creditWalletTx(
                tx as Parameters<typeof creditWalletTx>[0],
                order.userId,
                new Decimal(order.costUsd.toString()),
                {
                  type: "REFUND",
                  description: `Refund: order #${orderId} cancelled via API v2`,
                  orderId,
                  inrRate: new Decimal(order.inrRateAtOrder.toString()),
                  paymentGatewayId: idempotencyKey,
                },
              );
            });

            // Cancel with fulfillment provider (best-effort, after DB committed)
            if (order.providerOrderId) {
              const providerId = order.fulfillmentProviderId ?? order.service.providerId;
              let provider = order.service.provider;
              if (providerId !== order.service.providerId) {
                const alt = await fastify.prisma.provider.findUnique({ where: { id: providerId } });
                if (alt) provider = alt;
              }
              try {
                const client = new ProviderClient(provider);
                await client.cancelOrder(order.providerOrderId);
              } catch (err) {
                fastify.log.warn({ err, orderId }, "Provider cancel failed (order refunded locally)");
              }
            }

            return { order: orderId, cancel: 1 };
          } catch {
            return { order: orderId, cancel: { error: "Cancellation failed" } };
          }
        }));

        return reply.send(results);
      }

      case "balance": {
        const freshUser = await fastify.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { walletBalance: true } });
        return reply.send({ balance: new Decimal(freshUser.walletBalance.toString()).toFixed(8), currency: "USD" });
      }

      default:
        return reply.status(400).send({ error: "Invalid action" });
    }
  });
}