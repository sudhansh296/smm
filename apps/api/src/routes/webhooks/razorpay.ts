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
  fastify.post("/razorpay", {
    config: {
      rawBody: true,
      // Webhook-safe rate limit: higher than global to handle Razorpay burst retries.
      // Signature verification + idempotency remain mandatory regardless.
      rateLimit: {
        max: 200,
        timeWindow: 60_000,
      },
    },
  }, async (request, reply) => {

    // 1. Signature verification -- mandatory for test/live, skipped only in mock
    const signature = request.headers["x-razorpay-signature"] as string | undefined;
    const rawBody   = (request as unknown as Record<string, unknown>)["rawBody"] as string | undefined;

    if (!signature || !rawBody) {
      return reply.status(400).send({ error: "Missing signature or body" });
    }

    if (env.RAZORPAY_MODE !== "mock") {
      const expectedSig = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest("hex");
      if (!safeEqual(expectedSig, signature)) {
        fastify.log.warn("Razorpay webhook: signature mismatch");
        return reply.status(400).send({ error: "Invalid signature" });
      }
    }

    // 2. Parse and validate event structure
    const event = request.body as {
      event: string;
      payload?: { payment?: { entity?: { id: string; order_id: string; amount: number; currency: string } } };
    };

    // 3. Route by event type
    if (event.event === "payment.failed") {
      const failedEntity = event.payload?.payment?.entity;
      if (failedEntity?.order_id) {
        const deposit = await fastify.prisma.depositRequest.findFirst({
          where: { gatewayOrderId: failedEntity.order_id },
          select: { id: true, status: true, gateway: true },
        }) as any;
        if (deposit && deposit.gateway === "razorpay" && deposit.status === "PENDING") {
          await fastify.prisma.depositRequest.update({
            where: { id: deposit.id },
            data:  { status: "FAILED" as never },
          });
          fastify.log.info({ orderId: failedEntity.order_id }, "Razorpay webhook: deposit marked FAILED");
        }
      }
      return reply.status(200).send({ ok: true });
    }

    // Only process payment.captured for wallet credit
    if (event.event !== "payment.captured") {
      return reply.status(200).send({ ok: true });
    }

    const entity = event.payload?.payment?.entity;
    if (!entity?.id || !entity.order_id || !entity.amount) {
      fastify.log.warn({ event: event.event }, "Razorpay webhook: malformed payment.captured payload");
      return reply.status(400).send({ error: "Malformed payload" });
    }

    const { id: paymentId, order_id: razorpayOrderId, amount: amountPaise, currency } = entity;

    // 4. Currency check -- only accept INR
    if (currency !== "INR") {
      fastify.log.warn({ paymentId, razorpayOrderId, currency }, "Razorpay webhook: unexpected currency -- ignoring");
      return reply.status(200).send({ ok: true });
    }

    const amountInr = amountPaise / 100;

    // 5. Pre-flight DB check BEFORE entering transaction (avoids holding lock for unknown orders)
    const deposit = await fastify.prisma.depositRequest.findFirst({
      where: { gatewayOrderId: razorpayOrderId },
      select: { id: true, status: true, gateway: true, amountInr: true },
    }) as { id: string; status: string; gateway: string; amountInr: string | null } | null;

    if (!deposit) {
      // Signed but unknown order -- log and ack
      fastify.log.warn({ razorpayOrderId, paymentId }, "Razorpay webhook: no matching deposit (unknown order)");
      return reply.status(200).send({ ok: true });
    }

    // 6. Gateway check -- must be a Razorpay deposit
    if (deposit.gateway !== "razorpay") {
      fastify.log.warn(
        { razorpayOrderId, paymentId, gateway: deposit.gateway },
        "Razorpay webhook SECURITY: order_id matched non-Razorpay deposit -- aborting"
      );
      return reply.status(200).send({ ok: true });
    }

    // 7. Already completed -- idempotent ack without double-credit
    if (deposit.status === "COMPLETED") {
      fastify.log.info({ razorpayOrderId, paymentId }, "Razorpay webhook: deposit already completed (duplicate delivery)");
      return reply.status(200).send({ ok: true });
    }

    // 8. Amount mismatch check (tolerance: 1 INR for floating point)
    if (deposit.amountInr !== null) {
      const expectedInr = Number(deposit.amountInr);
      const diff = Math.abs(amountInr - expectedInr);
      if (diff > 1) {
        fastify.log.warn(
          { razorpayOrderId, paymentId, webhookAmountInr: amountInr, depositAmountInr: expectedInr },
          "Razorpay webhook SECURITY: amount mismatch -- wallet credit aborted"
        );
        return reply.status(200).send({ ok: true }); // ack to stop retries
      }
    }

    // 9. Finalize atomically -- DB failure returns 500 so Razorpay retries
    let result;
    try {
      result = await finalizeRazorpayDeposit(
        fastify.prisma,
        razorpayOrderId,
        paymentId,
        { amountInrOverride: amountInr },
      );
    } catch (err) {
      fastify.log.error({ err, razorpayOrderId, paymentId }, "Razorpay webhook: finalization error");
      return reply.status(500).send({ error: "Internal processing error" });
    }

    if (result.status === "not_found") {
      fastify.log.warn({ razorpayOrderId, paymentId }, "Razorpay webhook: deposit not found during finalization");
      return reply.status(200).send({ ok: true });
    }

    if (result.status === "already_done") {
      fastify.log.info({ razorpayOrderId, paymentId }, "Razorpay webhook: already credited (race with /verify -- OK)");
      return reply.status(200).send({ ok: true });
    }

    fastify.log.info(
      { paymentId, userId: result.userId, usd: result.amountUsd, inr: amountInr },
      "Razorpay webhook: wallet credited successfully"
    );
    return reply.status(200).send({ ok: true });
  });
}