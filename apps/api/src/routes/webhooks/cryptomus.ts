import type { FastifyInstance } from "fastify";
import { createHash } from "crypto";
import { Decimal } from "decimal.js";
import { env } from "../../lib/env.js";
import { creditWalletTx } from "../../services/wallet.service.js";

export default async function cryptomusWebhookRoute(fastify: FastifyInstance) {
  fastify.post("/cryptomus", {
    config: {
      // Explicit rate limit for Cryptomus webhooks -- handles burst retries safely
      rateLimit: { max: 200, timeWindow: 60_000 },
    },
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const { sign, ...bodyWithoutSign } = body;

    if (!sign) {
      return reply.status(400).send({ error: "Missing signature" });
    }

    const computedSign = createHash("md5")
      .update(Buffer.from(JSON.stringify(bodyWithoutSign)).toString("base64") + env.CRYPTOMUS_API_KEY)
      .digest("hex");

    if (computedSign !== sign) {
      fastify.log.warn("Cryptomus webhook signature mismatch");
      return reply.status(400).send({ error: "Invalid signature" });
    }

    const cryptomusStatus = body["status"] as string;
    const cryptomusUuid   = body["uuid"] as string;

    if (!cryptomusUuid) {
      return reply.status(400).send({ error: "Invalid payload: missing uuid" });
    }

    // Handle non-paid terminal statuses -- mark deposit, no wallet credit
    if (cryptomusStatus === "fail" || cryptomusStatus === "failed") {
      const d = await fastify.prisma.depositRequest.findFirst({
        where: { gatewayOrderId: cryptomusUuid },
        select: { id: true, status: true },
      }) as any;
      if (d && d.status === "PENDING") {
        await fastify.prisma.depositRequest.update({
          where: { id: d.id },
          data:  { status: "FAILED" as any },
        });
      }
      return reply.status(200).send({ ok: true });
    }

    if (cryptomusStatus === "cancel" || cryptomusStatus === "cancelled") {
      const d = await fastify.prisma.depositRequest.findFirst({
        where: { gatewayOrderId: cryptomusUuid },
        select: { id: true, status: true },
      }) as any;
      if (d && d.status === "PENDING") {
        await fastify.prisma.depositRequest.update({
          where: { id: d.id },
          data:  { status: "CANCELLED" as any },
        });
      }
      return reply.status(200).send({ ok: true });
    }

    if (cryptomusStatus === "expired") {
      const d = await fastify.prisma.depositRequest.findFirst({
        where: { gatewayOrderId: cryptomusUuid },
        select: { id: true, status: true },
      }) as any;
      if (d && d.status === "PENDING") {
        await fastify.prisma.depositRequest.update({
          where: { id: d.id },
          data:  { status: "EXPIRED" as any },
        });
      }
      return reply.status(200).send({ ok: true });
    }

    // Only credit wallet for paid/paid_over
    if (cryptomusStatus !== "paid" && cryptomusStatus !== "paid_over") {
      return reply.status(200).send({ ok: true });
    }

    const usdtAmount = parseFloat(body["amount"] as string);
    if (isNaN(usdtAmount)) {
      return reply.status(400).send({ error: "Invalid payload: bad amount" });
    }

    // Fully atomic: idempotency + wallet credit + deposit complete
    await fastify.prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findUnique({ where: { paymentGatewayId: cryptomusUuid } });
      if (existing) return;

      const deposit = await tx.depositRequest.findUnique({ where: { gatewayOrderId: cryptomusUuid } });
      if (!deposit || deposit.status === "COMPLETED") return;

      const usdAmount = new Decimal(usdtAmount).toDecimalPlaces(8);

      await creditWalletTx(
        tx as Parameters<typeof creditWalletTx>[0],
        deposit.userId,
        usdAmount,
        {
          type: "DEPOSIT_USDT",
          description: `USDT deposit $${usdAmount.toFixed(8)}`,
          paymentGatewayId: cryptomusUuid,
        },
      );

      await tx.depositRequest.update({
        where: { id: deposit.id },
        data: { status: "COMPLETED", gatewayPaymentId: cryptomusUuid },
      });

      fastify.log.info({ cryptomusUuid, userId: deposit.userId, usd: usdAmount.toFixed(8) }, "Cryptomus credited");
    });

    return reply.status(200).send({ ok: true });
  });
}