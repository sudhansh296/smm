import type { FastifyInstance } from "fastify";
import { createHash, timingSafeEqual } from "crypto";
import { Decimal } from "decimal.js";
import { env } from "../../lib/env.js";
import { creditWalletTx } from "../../services/wallet.service.js";

function safeSignatureEqual(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a, "utf8");
    const bBuf = Buffer.from(b, "utf8");
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

export default async function cryptomusWebhookRoute(fastify: FastifyInstance) {
  fastify.post("/cryptomus", {
    config: { rateLimit: { max: 200, timeWindow: 60_000 } },
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    // 1. Signature verification
    const { sign, ...bodyWithoutSign } = body;
    if (!sign) {
      return reply.status(400).send({ error: "Missing signature" });
    }

    const computedSign = createHash("md5")
      .update(Buffer.from(JSON.stringify(bodyWithoutSign)).toString("base64") + env.CRYPTOMUS_API_KEY)
      .digest("hex");

    if (!safeSignatureEqual(computedSign, sign as string)) {
      fastify.log.warn("Cryptomus webhook: signature mismatch");
      return reply.status(400).send({ error: "Invalid signature" });
    }

    // 2. Validate required fields
    const cryptomusUuid = body["uuid"] as string | undefined;
    const cryptomusStatus = body["status"] as string | undefined;

    if (!cryptomusUuid || !cryptomusStatus) {
      return reply.status(400).send({ error: "Invalid payload: missing uuid or status" });
    }

    // 3. Pre-flight: find deposit before entering transaction
    const deposit = await fastify.prisma.depositRequest.findFirst({
      where: { gatewayOrderId: cryptomusUuid },
      select: { id: true, userId: true, gateway: true, status: true, amountUsdt: true },
    }) as any;

    if (!deposit) {
      fastify.log.warn({ cryptomusUuid }, "Cryptomus webhook: unknown uuid");
      return reply.status(200).send({ ok: true });
    }

    if (deposit.gateway !== "cryptomus") {
      fastify.log.warn(
        { cryptomusUuid, gateway: deposit.gateway },
        "Cryptomus webhook SECURITY: uuid matched non-cryptomus deposit",
      );
      return reply.status(200).send({ ok: true });
    }

    // 4. Status routing

    // Intermediate / still-processing statuses — keep PENDING, no wallet credit
    if (["process", "check", "confirm_check"].includes(cryptomusStatus)) {
      return reply.status(200).send({ ok: true });
    }

    // Failure statuses -- atomic: only PENDING -> FAILED, never overwrites COMPLETED
    if (["fail", "failed", "system_fail", "wrong_amount"].includes(cryptomusStatus)) {
      const updated = await fastify.prisma.depositRequest.updateMany({
        where: { id: deposit.id, gateway: "cryptomus", status: "PENDING" },
        data:  { status: "FAILED" },
      });
      if (updated.count > 0) {
        fastify.log.info({ cryptomusUuid, reason: cryptomusStatus }, "Cryptomus webhook: deposit FAILED");
      }
      return reply.status(200).send({ ok: true });
    }

    // Cancel statuses -- atomic: only PENDING -> CANCELLED
    if (["cancel", "cancelled"].includes(cryptomusStatus)) {
      await fastify.prisma.depositRequest.updateMany({
        where: { id: deposit.id, gateway: "cryptomus", status: "PENDING" },
        data:  { status: "CANCELLED" },
      });
      return reply.status(200).send({ ok: true });
    }

    // Expired -- atomic: only PENDING -> EXPIRED
    if (cryptomusStatus === "expired") {
      await fastify.prisma.depositRequest.updateMany({
        where: { id: deposit.id, gateway: "cryptomus", status: "PENDING" },
        data:  { status: "EXPIRED" },
      });
      return reply.status(200).send({ ok: true });
    }

    // Refund statuses — log and ack, no wallet debit in this implementation
    if (["refund_process", "refund_fail", "refund_paid"].includes(cryptomusStatus)) {
      fastify.log.info(
        { cryptomusUuid, status: cryptomusStatus },
        "Cryptomus webhook: refund event received (no action)",
      );
      return reply.status(200).send({ ok: true });
    }

    // 5. Credit wallet for paid / paid_over
    if (cryptomusStatus !== "paid" && cryptomusStatus !== "paid_over") {
      // Unknown status — ack safely
      fastify.log.info({ cryptomusUuid, cryptomusStatus }, "Cryptomus webhook: unhandled status, acking");
      return reply.status(200).send({ ok: true });
    }

    if (cryptomusStatus === "paid_over") {
      fastify.log.info({ cryptomusUuid }, "Cryptomus webhook: paid_over — crediting only requested amount");
    }

    // Already completed — idempotent ack
    if (deposit.status === "COMPLETED") {
      fastify.log.info({ cryptomusUuid }, "Cryptomus webhook: already completed (duplicate delivery)");
      return reply.status(200).send({ ok: true });
    }

    if (!deposit.amountUsdt) {
      fastify.log.error({ cryptomusUuid }, "Cryptomus webhook: deposit has no amountUsdt");
      return reply.status(500).send({ error: "Internal error" });
    }

    // SECURITY: use DB-stored amount, NOT webhook body amount.
    // This prevents webhook manipulation from inflating wallet credit.
    let credited = false;
    try {
      await fastify.prisma.$transaction(async (tx) => {
        // Idempotency check on transaction record
        const existing = await tx.transaction.findUnique({ where: { paymentGatewayId: cryptomusUuid } });
        if (existing) return;

        const dep = await tx.depositRequest.findUnique({
          where: { id: deposit.id },
          select: { status: true, amountUsdt: true, userId: true },
        }) as any;
        // Only credit PENDING deposits -- FAILED/CANCELLED must NOT be credited
        if (!dep || dep.status !== "PENDING") return;

        // Use server-stored amount — NOT webhook body amount
        const usdAmount = new Decimal(dep.amountUsdt.toString()).toDecimalPlaces(8);

        await creditWalletTx(
          tx as Parameters<typeof creditWalletTx>[0],
          dep.userId,
          usdAmount,
          {
            type: "DEPOSIT_USDT",
            description: `Cryptomus USDT deposit $${usdAmount.toFixed(2)}`,
            paymentGatewayId: cryptomusUuid,
          },
        );

        await tx.depositRequest.update({
          where: { id: deposit.id },
          data: { status: "COMPLETED", gatewayPaymentId: cryptomusUuid },
        });

        credited = true;
      });
    } catch (err) {
      fastify.log.error({ err, cryptomusUuid }, "Cryptomus webhook: finalization error");
      return reply.status(500).send({ error: "Internal processing error" });
    }

    if (credited) {
      fastify.log.info({ cryptomusUuid, userId: deposit.userId }, "Cryptomus webhook: wallet credited");
    }
    return reply.status(200).send({ ok: true });
  });
}
