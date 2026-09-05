import type { FastifyInstance } from "fastify";
import { createHash } from "crypto";
import { Decimal } from "decimal.js";
import { z } from "zod";
import { createOrder } from "../../services/order.service.js";
import { refundOrderTx } from "../../services/wallet.service.js";
import { ProviderClient } from "../../services/provider.service.js";

const API_V2_RATE_LIMIT_MAX = 60;
const API_V2_RATE_WINDOW = 60_000;

// Validate link is a real URL Ã¢â‚¬â€ prevents garbage reaching provider
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

// Standard SMM panel API status vocabulary
// Internal statuses must be mapped before returning to external clients
const V2_STATUS_MAP: Record<string, string> = {
  PENDING:     "Pending",
  PROCESSING:  "Processing",
  IN_PROGRESS: "In progress",
  COMPLETED:   "Completed",
  PARTIAL:     "Partial",
  CANCELLED:   "Canceled",
  REFUNDED:    "Canceled", // refunded orders appear as Canceled to API clients
};

function toV2Status(internalStatus: string): string {
  return V2_STATUS_MAP[internalStatus] ?? "Pending";
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

        // Validate URL server-side Ã¢â‚¬â€ not just frontend
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
          status: toV2Status(order.status), remains: order.remains ?? 0, currency: "USD",
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
            ? { charge: new Decimal(o.costUsd.toString()).toFixed(8), start_count: o.startCount ?? 0, status: toV2Status(o.status), remains: o.remains ?? 0, currency: "USD" }
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

        // Atomic conditional update Ã¢â‚¬â€ prevents race condition
        const updated = await fastify.prisma.order.updateMany({
          where: {
            id: orderId,
            userId: user.id,
            status: { in: ["COMPLETED", "PARTIAL"] },
            refillStatus: { notIn: ["pending", "processing"] },
          },
          data: { refillRequestedAt: new Date(), refillStatus: "pending" },
        });
        if (updated.count === 0) {
          return reply.status(400).send({ error: "A refill is already in progress" });
        }
        const bucket = Math.floor(Date.now() / (5 * 60 * 1000));
        await fastify.queues.refill.add("refill", { orderId }, {
          jobId: `refill:${orderId}:${bucket}`,
          removeOnComplete: true,
          removeOnFail: true,
        });
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

          try {
            await fastify.prisma.$transaction(async (tx) => {
              // Row-lock to prevent race condition
              const locked = await tx.$queryRaw<Array<{ status: string; refundedAt: Date | null }>>`
                SELECT status, "refundedAt" FROM orders WHERE id = ${orderId} FOR UPDATE
              `;
              if (!locked[0] || !["PENDING", "PROCESSING"].includes(locked[0].status)) return;

              await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });

              await refundOrderTx(
                tx as Parameters<typeof refundOrderTx>[0],
                orderId,
                {
                  userId: order.userId,
                  amountUsd: new Decimal(order.costUsd.toString()),
                  inrRate: new Decimal(order.inrRateAtOrder.toString()),
                  description: `Refund: order #${orderId} cancelled via API v2`,
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