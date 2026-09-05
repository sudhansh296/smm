import type { FastifyInstance } from "fastify";
// Razorpay SDK loaded conditionally
import { z } from "zod";
import { createHmac } from "crypto";
import { getEffectiveInrRate } from "../../services/currency.service.js";
import { ValidationError } from "../../lib/errors.js";
import { env } from "../../lib/env.js";
import { Decimal } from "decimal.js";

export default async function razorpayDepositRoute(fastify: FastifyInstance) {
    const isProduction = process.env["NODE_ENV"] === "production";
    const isMock = !isProduction && (!env.RAZORPAY_KEY_ID || env.RAZORPAY_KEY_ID === "mock" || env.RAZORPAY_KEY_ID.startsWith("rzp_test_xxx"));

    // Block mock mode in production — payment security requirement
    if (isProduction && (!env.RAZORPAY_KEY_ID || env.RAZORPAY_KEY_ID === "mock" || env.RAZORPAY_KEY_ID.startsWith("rzp_test_xxx"))) {
      fastify.log.error("Razorpay mock credentials detected in production — refusing to serve payment endpoints");
      throw new Error("Payment gateway not configured for production");
    }
  // Only import Razorpay SDK when real keys are present
  let razorpay: any = null;
  if (!isMock) {
    const { default: Razorpay } = await import("razorpay");
    razorpay = new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
  }

  // Create Razorpay order
  fastify.post("/razorpay", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { amountInr } = z.object({
      amountInr: z.coerce.number().min(50, "Minimum ₹50").max(100000),
    }).parse(request.body);

    const effectiveRate = await getEffectiveInrRate(fastify.redis, fastify.prisma);
    const amountUsd = new Decimal(amountInr).dividedBy(effectiveRate).toDecimalPlaces(8);

    let rzpOrderId: string;
    if (isMock) {
      rzpOrderId = `rzp_mock_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    } else {
      const rzpOrder = await razorpay!.orders.create({
        amount: Math.round(amountInr * 100),
        currency: "INR",
        receipt: `nexussmm_${Date.now()}`,
      });
      if (!rzpOrder?.id) throw new ValidationError("Failed to create Razorpay order");
      rzpOrderId = rzpOrder.id;
    }

    await fastify.prisma.depositRequest.create({
      data: {
        userId: request.user.sub,
        gateway: "razorpay",
        method: "RAZORPAY",
        amountInr,
        amountUsdt: null,
        gatewayOrderId: rzpOrderId,
        inrRateSnapshot: new Decimal(effectiveRate).toDecimalPlaces(4).toNumber(),
      } as any,
    });

    return reply.send({
      razorpayOrderId: rzpOrderId,
      amountInr,
      currency: "INR",
      keyId: env.RAZORPAY_KEY_ID,
      effectiveRate: effectiveRate.toFixed(4),
      usdEquivalent: amountUsd.toFixed(2),
      isMock,
    });
  });

  // Verify Razorpay payment after success callback
  fastify.post("/razorpay/verify", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = z.object({
      razorpay_order_id: z.string(),
      razorpay_payment_id: z.string(),
      razorpay_signature: z.string(),
    }).parse(request.body);

    // Verify signature
    const isValid = isMock ? true : (() => {
      const body = razorpay_order_id + "|" + razorpay_payment_id;
      const expected = createHmac("sha256", env.RAZORPAY_KEY_SECRET).update(body).digest("hex");
      return expected === razorpay_signature;
    })();
    if (!isValid) return reply.status(400).send({ error: "Invalid payment signature" });

    const deposit = await fastify.prisma.depositRequest.findUnique({ where: { gatewayOrderId: razorpay_order_id } });
    if (!deposit) return reply.status(404).send({ error: "Deposit not found" });
    if (deposit.status === "COMPLETED") return reply.send({ message: "Already credited" });

    // Bug 6 fix: use inrRateSnapshot (rate at time of deposit creation), not current rate
    if (!(deposit as any).inrRateSnapshot) {
      fastify.log.error({ depositId: deposit.id }, "Missing inrRateSnapshot on deposit");
      return reply.status(500).send({ error: "Cannot process payment — rate snapshot missing" });
    }
    const snapshotRate = new Decimal((deposit as any).inrRateSnapshot.toString());
    const amountUsd = new Decimal((deposit as any).amountInr).dividedBy(snapshotRate).toDecimalPlaces(8);

    await fastify.prisma.$transaction(async (tx) => {
      await tx.depositRequest.update({
        where: { id: deposit.id },
        data: { status: "COMPLETED", gatewayPaymentId: razorpay_payment_id } as any,
      });
      const rows = await tx.$queryRaw<Array<{ walletBalance: string }>>`SELECT "walletBalance" FROM "users" WHERE id = ${deposit.userId} FOR UPDATE`;
      const balance = new Decimal(rows[0].walletBalance);
      const newBalance = balance.plus(amountUsd);
      await tx.user.update({ where: { id: deposit.userId }, data: { walletBalance: newBalance.toDecimalPlaces(8).toNumber() } });
      await tx.transaction.create({
        data: {
          userId: deposit.userId,
          type: "DEPOSIT_INR",
          amountUsd: amountUsd.toDecimalPlaces(8).toNumber(),
          amountInr: new Decimal((deposit as any).amountInr).toDecimalPlaces(4).toNumber(),
          inrRate: snapshotRate.toDecimalPlaces(4).toNumber(),
          description: `Razorpay deposit ₹${(deposit as any).amountInr}`,
          balanceBefore: balance.toDecimalPlaces(8).toNumber(),
          balanceAfter: newBalance.toDecimalPlaces(8).toNumber(),
          paymentGatewayId: razorpay_payment_id,
        },
      });
      await tx.notification.create({ data: { userId: deposit.userId, message: `₹${(deposit as any).amountInr} deposited via Razorpay. $${amountUsd.toFixed(2)} added to your wallet.` } });
    });

    return reply.send({ message: "Payment verified. Wallet credited.", amountUsd: amountUsd.toFixed(2) });
  });
}

