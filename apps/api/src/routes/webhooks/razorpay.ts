import type { FastifyInstance } from "fastify";
import { createHmac, timingSafeEqual as cryptoTimingSafeEqual } from "crypto";
import { env } from "../../lib/env.js";
import { finalizeRazorpayDeposit } from "../deposits/razorpay.js";

function safeEqual(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a, "utf8");
    const bBuf = Buffer.from(b, "utf8");
    if (aBuf.length !== bBuf.length) return false;
    return cryptoTimingSafeEqual(aBuf, bBuf);
  } catch { return false; }
}

export default async function razorpayWebhookRoute(fastify: FastifyInstance) {
  fastify.post("/razorpay", { config: { rawBody: true } }, async (request, reply) => {
    const signature = request.headers["x-razorpay-signature"] as string;
    const rawBody   = (request as Record<string, unknown>)["rawBody"] as string | undefined;

    if (!signature || !rawBody) return reply.status(400).send({ error: "Missing signature or body" });

    const expectedSig = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest("hex");
    if (!safeEqual(expectedSig, signature)) {
      fastify.log.warn("Razorpay webhook signature mismatch");
      return reply.status(400).send({ error: "Invalid signature" });
    }

    const event = request.body as {
      event: string;
      payload: { payment: { entity: { id: string; order_id: string; amount: number } } };
    };

    if (event.event !== "payment.captured") return reply.status(200).send({ ok: true });

    const { id: paymentId, order_id: razorpayOrderId, amount: amountPaise } = event.payload.payment.entity;
    const amountInr = amountPaise / 100;

    const result = await finalizeRazorpayDeposit(
      fastify.prisma,
      razorpayOrderId,
      paymentId,
      { amountInrOverride: amountInr }, // webhook provides actual charged amount
    );

    if (result.status === "not_found") {
      // Signed webhook but no matching deposit -- log and ack (don't 4xx Razorpay)
      fastify.log.warn({ razorpayOrderId }, "Razorpay webhook: no matching deposit found");
      return reply.status(200).send({ ok: true });
    }

    if (result.status === "credited") {
      fastify.log.info({ paymentId, userId: result.userId, usd: result.amountUsd }, "Razorpay webhook credited");
    }

    return reply.status(200).send({ ok: true });
  });
}