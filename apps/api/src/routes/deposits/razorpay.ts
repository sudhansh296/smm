import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createHmac } from "crypto";
import { getEffectiveInrRate } from "../../services/currency.service.js";
import { ValidationError } from "../../lib/errors.js";
import { env } from "../../lib/env.js";
import { Decimal } from "decimal.js";
import type { PrismaClient } from "@nexussmm/db";

// Typed result -- callers must handle all 3 cases explicitly
type FinalizeRazorpayResult =
  | { status: "credited";     amountUsd: string; userId: string }
  | { status: "already_done"; amountUsd: string; userId: string }
  | { status: "not_found" };

// Shared atomic finalization used by both /verify and webhook.
// expectedUserId: when set, rejects deposits belonging to other users (verify path only).
export async function finalizeRazorpayDeposit(
  prisma: PrismaClient,
  razorpayOrderId: string,
  paymentId: string,
  options: { amountInrOverride?: number; expectedUserId?: string } = {},
): Promise<FinalizeRazorpayResult> {
  let result: FinalizeRazorpayResult = { status: "not_found" };

  await prisma.$transaction(async (tx) => {
    // 1. Lock deposit row -- prevents concurrent verify + webhook double-credit
    const deposits = await tx.$queryRaw<Array<{
      id: string; status: string; userId: string;
      amountInr: string | null; inrRateSnapshot: string | null;
    }>>`
      SELECT id, status, "userId", "amountInr", "inrRateSnapshot"
      FROM deposit_requests
      WHERE "gatewayOrderId" = ${razorpayOrderId}
      FOR UPDATE
    `;

    const deposit = deposits[0];
    if (!deposit) { result = { status: "not_found" }; return; }

    // 2. Ownership check (verify path) -- prevents one user claiming another's deposit
    if (options.expectedUserId && deposit.userId !== options.expectedUserId) {
      result = { status: "not_found" };
      return;
    }

    // 3. Already completed
    if (deposit.status === "COMPLETED") {
      result = { status: "already_done", amountUsd: "0", userId: deposit.userId };
      return;
    }

    // 4. Idempotency check on transaction record
    const existing = await tx.transaction.findUnique({ where: { paymentGatewayId: paymentId } });
    if (existing) {
      result = { status: "already_done", amountUsd: "0", userId: deposit.userId };
      return;
    }

    if (!deposit.inrRateSnapshot) throw new ValidationError("Rate snapshot missing on deposit");

    // 5. Calculate USD using snapshot rate (never current rate)
    const inrAmount    = options.amountInrOverride ?? Number(deposit.amountInr ?? 0);
    const snapshotRate = new Decimal(deposit.inrRateSnapshot.toString());
    const amountUsd    = new Decimal(inrAmount).dividedBy(snapshotRate).toDecimalPlaces(8);

    // 6. Lock user wallet row
    const rows = await tx.$queryRaw<Array<{ walletBalance: string }>>`
      SELECT "walletBalance" FROM users WHERE id = ${deposit.userId} FOR UPDATE
    `;
    if (!rows[0]) throw new Error("User not found");
    const balance    = new Decimal(rows[0].walletBalance);
    const newBalance = balance.plus(amountUsd);

    // 7. Update deposit, credit wallet, create ledger entry, notify
    await tx.depositRequest.update({
      where: { id: deposit.id },
      data: { status: "COMPLETED", gatewayPaymentId: paymentId } as any,
    });
    await tx.user.update({
      where: { id: deposit.userId },
      data: { walletBalance: newBalance.toDecimalPlaces(8).toNumber() },
    });
    await tx.transaction.create({
      data: {
        userId:           deposit.userId,
        type:             "DEPOSIT_INR",
        amountUsd:        amountUsd.toDecimalPlaces(8).toNumber(),
        amountInr:        new Decimal(inrAmount).toDecimalPlaces(4).toNumber(),
        inrRate:          snapshotRate.toDecimalPlaces(4).toNumber(),
        description:      `Razorpay deposit Rs.${inrAmount}`,
        balanceBefore:    balance.toDecimalPlaces(8).toNumber(),
        balanceAfter:     newBalance.toDecimalPlaces(8).toNumber(),
        paymentGatewayId: paymentId,
      },
    });
    await tx.notification.create({
      data: {
        userId:  deposit.userId,
        message: `Rs.${inrAmount} deposited via Razorpay. $${amountUsd.toFixed(2)} added to your wallet.`,
      },
    });

    result = { status: "credited", amountUsd: amountUsd.toFixed(2), userId: deposit.userId };
  });

  return result;
}

export default async function razorpayDepositRoute(fastify: FastifyInstance) {
  const mode = env.RAZORPAY_MODE; // "mock" | "test" | "live"
  const isMock = mode === "mock";
  const isLive = mode === "live";

  // Startup guard: production must never use mock
  if (env.NODE_ENV === "production" && isMock) {
    throw new Error("RAZORPAY_MODE=mock is not allowed in production");
  }

  let razorpay: any = null;
  if (!isMock) {
    const { default: Razorpay } = await import("razorpay");
    razorpay = new Razorpay({
      key_id:     env.RAZORPAY_KEY_ID,
      key_secret: env.RAZORPAY_KEY_SECRET,
    });
  }

  // POST /deposits/razorpay -- create order
  fastify.post("/razorpay", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { amountInr } = z.object({
      amountInr: z.coerce.number().min(50, "Minimum Rs.50").max(100000),
    }).parse(request.body);

    const effectiveRate = await getEffectiveInrRate(fastify.redis, fastify.prisma);
    const amountUsd = new Decimal(amountInr).dividedBy(effectiveRate).toDecimalPlaces(8);

    let rzpOrderId: string;

    if (isMock) {
      // Mock mode: never contacts Razorpay -- only allowed in non-production
      rzpOrderId = `rzp_mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    } else {
      // test or live: create real Razorpay order via SDK
      const rzpOrder = await razorpay!.orders.create({
        amount:   Math.round(amountInr * 100), // paise
        currency: "INR",
        receipt:  `nexussmm_${Date.now()}`,
      });
      if (!rzpOrder?.id) throw new ValidationError("Failed to create Razorpay order");
      rzpOrderId = rzpOrder.id as string;
    }

    await fastify.prisma.depositRequest.create({
      data: {
        userId:          request.user.sub,
        gateway:         "razorpay",
        method:          "RAZORPAY",
        amountInr,
        amountUsdt:      null,
        gatewayOrderId:  rzpOrderId,
        inrRateSnapshot: new Decimal(effectiveRate).toDecimalPlaces(4).toNumber(),
      } as any,
    });

    return reply.send({
      razorpayOrderId: rzpOrderId,
      amountInr,
      currency:       "INR",
      keyId:          env.RAZORPAY_KEY_ID,   // only key_id exposed to frontend; secret never sent
      effectiveRate:  effectiveRate.toFixed(4),
      usdEquivalent:  amountUsd.toFixed(2),
      isMock,
      isTestMode:     mode === "test",        // frontend uses this to show test badge
    });
  });

  // POST /deposits/razorpay/verify -- verify checkout signature + server-side payment status, then credit wallet
  fastify.post("/razorpay/verify", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = z.object({
      razorpay_order_id:   z.string(),
      razorpay_payment_id: z.string(),
      razorpay_signature:  z.string(),
    }).parse(request.body);

    // Step 1: Verify checkout HMAC signature
    // mock: skip | test/live: always verify -- never bypass
    const signatureValid = isMock
      ? true
      : (() => {
          const body     = razorpay_order_id + "|" + razorpay_payment_id;
          const expected = createHmac("sha256", env.RAZORPAY_KEY_SECRET).update(body).digest("hex");
          return expected === razorpay_signature;
        })();

    if (!signatureValid) {
      fastify.log.warn({ razorpay_order_id }, "Razorpay /verify: signature mismatch");
      return reply.status(400).send({ error: "Invalid payment signature" });
    }

    // Step 2: Server-side payment status verification (test/live only)
    // Do NOT trust frontend callback alone -- fetch actual payment from Razorpay API
    if (!isMock) {
      let payment: any;
      try {
        payment = await razorpay!.payments.fetch(razorpay_payment_id);
      } catch (err) {
        fastify.log.error({ err, razorpay_payment_id }, "Razorpay /verify: failed to fetch payment from Razorpay API");
        return reply.status(502).send({ error: "Could not verify payment with Razorpay. Please try again." });
      }

      // Verify payment ID matches
      if (payment.id !== razorpay_payment_id) {
        fastify.log.warn({ razorpay_payment_id, fetched: payment.id }, "Razorpay /verify: payment ID mismatch");
        return reply.status(400).send({ error: "Payment verification failed: ID mismatch" });
      }

      // Verify order ID matches
      if (payment.order_id !== razorpay_order_id) {
        fastify.log.warn({ razorpay_order_id, paymentOrderId: payment.order_id }, "Razorpay /verify: order_id mismatch");
        return reply.status(400).send({ error: "Payment verification failed: order mismatch" });
      }

      // Verify payment is captured
      if (payment.status !== "captured") {
        fastify.log.warn({ razorpay_payment_id, status: payment.status }, "Razorpay /verify: payment not captured");
        return reply.status(400).send({ error: `Payment not captured (status: ${payment.status})` });
      }

      // Verify currency
      if (payment.currency !== "INR") {
        fastify.log.warn({ razorpay_payment_id, currency: payment.currency }, "Razorpay /verify: unexpected currency");
        return reply.status(400).send({ error: "Payment verification failed: unexpected currency" });
      }

      // Verify amount matches DepositRequest (in paise)
      const deposit = await fastify.prisma.depositRequest.findFirst({
        where: { gatewayOrderId: razorpay_order_id, userId: request.user.sub },
        select: { amountInr: true },
      }) as { amountInr: string | null } | null;

      if (deposit?.amountInr !== null && deposit?.amountInr !== undefined) {
        const expectedPaise = Math.round(Number(deposit.amountInr) * 100);
        if (Math.abs(payment.amount - expectedPaise) > 1) {
          fastify.log.warn(
            { razorpay_payment_id, paymentPaise: payment.amount, expectedPaise },
            "Razorpay /verify SECURITY: amount mismatch -- aborting"
          );
          return reply.status(400).send({ error: "Payment verification failed: amount mismatch" });
        }
      }
    }

    // Step 3: Atomic wallet credit (idempotent -- safe if webhook already credited)
    const result = await finalizeRazorpayDeposit(
      fastify.prisma,
      razorpay_order_id,
      razorpay_payment_id,
      { expectedUserId: request.user.sub },
    );

    if (result.status === "not_found") {
      return reply.status(404).send({ error: "Deposit not found" });
    }
    if (result.status === "already_done") {
      return reply.send({ message: "Already credited", amountUsd: result.amountUsd });
    }
    return reply.send({ message: "Payment verified. Wallet credited.", amountUsd: result.amountUsd });
  });
  // POST /deposits/razorpay/cancel -- user cancels a PENDING deposit (e.g. modal dismiss)
  fastify.post("/razorpay/cancel", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { razorpayOrderId } = z.object({
      razorpayOrderId: z.string().min(1),
    }).parse(request.body);

    const deposit = await fastify.prisma.depositRequest.findFirst({
      where: { gatewayOrderId: razorpayOrderId },
      select: { id: true, userId: true, gateway: true, status: true },
    }) as any;

    if (!deposit) return reply.status(404).send({ error: "Deposit not found" });
    if (deposit.userId !== request.user.sub) return reply.status(404).send({ error: "Deposit not found" });
    if (deposit.gateway !== "razorpay") return reply.status(400).send({ error: "Not a Razorpay deposit" });
    if (deposit.status === "COMPLETED") return reply.status(400).send({ error: "Cannot cancel a completed deposit" });
    if (deposit.status !== "PENDING") return reply.send({ message: "Already cancelled or failed" });

    await fastify.prisma.depositRequest.update({
      where: { id: deposit.id },
      data:  { status: "CANCELLED" },
    });

    return reply.send({ message: "Deposit cancelled" });
  });

}