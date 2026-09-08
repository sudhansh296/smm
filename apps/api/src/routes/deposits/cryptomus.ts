import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import { env } from "../../lib/env.js";
import { ValidationError } from "../../lib/errors.js";
import { cryptomusRequest } from "../../services/cryptomus.service.js";

export default async function cryptomusDepositRoute(fastify: FastifyInstance) {
  const mode = env.CRYPTOMUS_MODE;

  // POST /deposits/cryptomus — create invoice
  fastify.post("/cryptomus", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { amountUsdt } = z.object({
      amountUsdt: z.coerce.number().min(1, "Minimum deposit is $1 USDT").max(100000),
    }).parse(request.body);

    const userId = request.user.sub;

    if (mode === "mock") {
      // Mock: no Cryptomus call, local DepositRequest only
      const uuid = randomUUID();
      await fastify.prisma.depositRequest.create({
        data: {
          userId,
          gateway: "cryptomus",
          method: "CRYPTOMUS",
          amountUsdt,
          gatewayOrderId: uuid,
          status: "PENDING",
        } as any,
      });
      return reply.send({
        invoiceId: uuid,
        amountUsdt: amountUsdt.toFixed(2),
        currency: "USDT",
        network: "tron",
        paymentAddress: null,
        paymentUrl: null,
        isMock: true,
        isTestMode: false,
      });
    }

    if (mode === "test") {
      // Test: local DepositRequest, no real Cryptomus invoice call
      const uuid = randomUUID();
      await fastify.prisma.depositRequest.create({
        data: {
          userId,
          gateway: "cryptomus",
          method: "CRYPTOMUS",
          amountUsdt,
          gatewayOrderId: uuid,
          status: "PENDING",
        } as any,
      });
      return reply.send({
        invoiceId: uuid,
        amountUsdt: amountUsdt.toFixed(2),
        currency: "USDT",
        network: "tron",
        paymentAddress: null,
        paymentUrl: null,
        isMock: false,
        isTestMode: true,
      });
    }

    // live: call real Cryptomus API
    const apiBaseUrl = env.API_BASE_URL;
    if (!apiBaseUrl || apiBaseUrl.includes("localhost") || apiBaseUrl.includes("127.0.0.1")) {
      throw new ValidationError("API_BASE_URL must be a public HTTPS URL for Cryptomus live mode");
    }

    const orderId = `nexussmm_${userId}_${Date.now()}`;
    const payload = {
      amount: amountUsdt.toFixed(2),
      currency: "USDT",
      order_id: orderId,
      network: "tron",
      url_callback: `${apiBaseUrl}/webhooks/cryptomus`,
      is_payment_multiple: false,
      lifetime: 3600,
    };

    const { ok, status, data } = await cryptomusRequest("/payment", payload);

    if (!ok) {
      fastify.log.error({ status }, "Cryptomus API error creating invoice");
      throw new ValidationError("Failed to create crypto invoice. Please try again.");
    }

    const result = (data as any)?.result;
    if (!result?.uuid) {
      fastify.log.error({ status }, "Cryptomus API returned no uuid");
      throw new ValidationError("Failed to create crypto invoice");
    }

    await fastify.prisma.depositRequest.create({
      data: {
        userId,
        gateway: "cryptomus",
        method: "CRYPTOMUS",
        amountUsdt,
        gatewayOrderId: result.uuid,
        status: "PENDING",
      } as any,
    });

    return reply.send({
      invoiceId: result.uuid,
      amountUsdt: result.amount,
      currency: result.currency,
      network: result.network,
      paymentAddress: result.address ?? null,
      paymentUrl: result.url ?? null,
      expiresAt: result.expired_at ? new Date(result.expired_at * 1000).toISOString() : null,
      isMock: false,
      isTestMode: false,
    });
  });

  // POST /deposits/cryptomus/test-event — DEV/TEST only
  // Triggers the official Cryptomus test-webhook flow, which causes Cryptomus
  // to deliver a real signed webhook to our public callback URL.
  if (mode === "test" && env.NODE_ENV !== "production") {
    fastify.post("/cryptomus/test-event", { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const ALLOWED_STATUSES = ["paid", "paid_over", "fail", "cancel", "wrong_amount", "system_fail", "process", "check"];
      const { depositId, status: eventStatus } = z.object({
        depositId: z.string().min(1),
        status: z.enum(ALLOWED_STATUSES as [string, ...string[]]),
      }).parse(request.body);

      const userId = request.user.sub;

      // Find deposit and verify ownership
      const deposit = await fastify.prisma.depositRequest.findUnique({
        where: { id: depositId },
        select: { id: true, userId: true, gateway: true, gatewayOrderId: true, amountUsdt: true, status: true },
      }) as any;

      if (!deposit || deposit.userId !== userId) {
        return reply.status(404).send({ error: "Deposit not found" });
      }
      if (deposit.gateway !== "cryptomus") {
        return reply.status(400).send({ error: "Not a Cryptomus deposit" });
      }

      // Check API_BASE_URL is a public HTTPS URL
      const apiBaseUrl = env.API_BASE_URL;
      if (
        !apiBaseUrl ||
        apiBaseUrl.includes("localhost") ||
        apiBaseUrl.includes("127.0.0.1") ||
        !apiBaseUrl.startsWith("https://")
      ) {
        return reply.status(400).send({
          error:
            "Cryptomus test webhook requires a public HTTPS API_BASE_URL " +
            "(e.g. set API_BASE_URL=https://xxxx.trycloudflare.com)",
        });
      }

      // Call official Cryptomus test-webhook endpoint.
      // This causes Cryptomus to send a REAL signed webhook to our callback URL.
      const payload = {
        uuid: deposit.gatewayOrderId,
        currency: "USDT",
        network: "tron",
        url_callback: `${apiBaseUrl}/webhooks/cryptomus`,
        status: eventStatus,
      };

      const { ok, status: httpStatus, data } = await cryptomusRequest("/test-webhook/payment", payload);

      if (!ok) {
        fastify.log.warn({ httpStatus }, "Cryptomus test-webhook call failed");
        return reply.status(502).send({
          error: "Cryptomus test-webhook API call failed",
          detail: (data as any)?.message ?? "Unknown error",
        });
      }

      return reply.send({
        message: "Webhook requested. Cryptomus will deliver a signed webhook to your callback URL shortly.",
        cryptomusResponse: data,
      });
    });
  }
}
