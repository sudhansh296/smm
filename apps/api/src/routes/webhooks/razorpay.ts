import type { FastifyInstance } from "fastify";
import { createHmac, timingSafeEqual as cryptoTimingSafeEqual } from "crypto";
import { Decimal } from "decimal.js";
import { env } from "../../lib/env.js";
import { creditWalletTx } from "../../services/wallet.service.js";

function safeEqual(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a, "utf8");
    const bBuf = Buffer.from(b, "utf8");
    if (aBuf.length !== bBuf.length) return false;
    return cryptoTimingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

export default async function razorpayWebhookRoute(fastify: FastifyInstance) {
  fastify.post(
    "/razorpay",
    { config: { rawBody: true } },
    async (request, reply) => {
      const signature = request.headers["x-razorpay-signature"] as string;
      const rawBody = (request as Record<string, unknown>)["rawBody"] as string | undefined;

      if (!signature || !rawBody) {
        return reply.status(400).send({ error: "Missing signature or body" });
      }

      const expectedSig = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
        .update(rawBody)
        .digest("hex");

      if (!safeEqual(expectedSig, signature)) {
        fastify.log.warn("Razorpay webhook signature mismatch");
        return reply.status(400).send({ error: "Invalid signature" });
      }

      const event = request.body as {
        event: string;
        payload: {
          payment: {
            entity: { id: string; order_id: string; amount: number; status: string };
          };
        };
      };

      if (event.event !== "payment.captured") {
        return reply.status(200).send({ ok: true });
      }

      const { id: paymentId, order_id: razorpayOrderId, amount: amountPaise } = event.payload.payment.entity;
      const amountInr = amountPaise / 100;

      // Fully atomic: idempotency check + wallet credit + deposit mark  --  single transaction
      await fastify.prisma.$transaction(async (tx) => {
        // Idempotency check  --  paymentGatewayId has unique constraint
        const existing = await tx.transaction.findUnique({ where: { paymentGatewayId: paymentId } });
        if (existing) return;

        const deposit = await tx.depositRequest.findUnique({ where: { gatewayOrderId: razorpayOrderId } });
        if (!deposit || !deposit.inrRateSnapshot || deposit.status === "COMPLETED") return;

        const inrRate = new Decimal(deposit.inrRateSnapshot.toString());
        const usdAmount = new Decimal(amountInr).dividedBy(inrRate).toDecimalPlaces(8);

        await creditWalletTx(
          tx as Parameters<typeof creditWalletTx>[0],
          deposit.userId,
          usdAmount,
          {
            type: "DEPOSIT_INR",
            description: `Razorpay deposit Rs.${amountInr.toFixed(2)} @ Rs.${inrRate.toFixed(4)}/$1`,
            amountInr: new Decimal(amountInr),
            inrRate,
            paymentGatewayId: paymentId,
          },
        );

        await tx.depositRequest.update({
          where: { id: deposit.id },
          data: { status: "COMPLETED", gatewayPaymentId: paymentId },
        });

        fastify.log.info({ paymentId, userId: deposit.userId, usd: usdAmount.toFixed(8) }, "Razorpay credited");
      });

      return reply.status(200).send({ ok: true });
    },
  );
}