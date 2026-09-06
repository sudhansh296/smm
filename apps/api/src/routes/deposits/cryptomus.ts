import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createHash } from "crypto";
import { env } from "../../lib/env.js";
import { ValidationError } from "../../lib/errors.js";

export default async function cryptomusDepositRoute(fastify: FastifyInstance) {
  fastify.post(
    "/cryptomus",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { amountUsdt } = z
        .object({
          amountUsdt: z.coerce.number().min(1, "Minimum deposit is $1 USDT"),
        })
        .parse(request.body);

      const orderId = `nexussmm_${request.user.sub}_${Date.now()}`;

      // Create Cryptomus invoice
      const payload = {
        amount: amountUsdt.toFixed(2),
        currency: "USDT",
        order_id: orderId,
        network: "TRON", // TRC20 USDT  --  lowest fees
        // Fix: use API_BASE_URL for webhook callback  --  not frontend URL with port substitution
        url_callback: `${process.env["API_BASE_URL"] ?? env.FRONTEND_URL.replace("3000", "3001")}/webhooks/cryptomus`,
        is_payment_multiple: false,
        lifetime: 3600, // 1 hour
      };

      const sign = createHash("md5")
        .update(
          Buffer.from(JSON.stringify(payload)).toString("base64") +
            env.CRYPTOMUS_API_KEY,
        )
        .digest("hex");

      const res = await fetch("https://api.cryptomus.com/v1/payment", {
        method: "POST",
        headers: {
          "merchant": env.CRYPTOMUS_MERCHANT_ID,
          "sign": sign,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        fastify.log.error({ status: res.status }, "Cryptomus API error");
        throw new ValidationError("Failed to create crypto invoice. Please try again.");
      }

      const data = (await res.json()) as {
        result?: {
          uuid: string;
          address: string;
          amount: string;
          currency: string;
          network: string;
          expired_at: number;
        };
        state?: number;
      };

      if (!data.result?.uuid) {
        throw new ValidationError("Failed to create crypto invoice");
      }

      // Store deposit request
      await fastify.prisma.depositRequest.create({
        data: {
          userId: request.user.sub,
          gateway: "cryptomus",
          method: "CRYPTOMUS",  // Fix 3: explicit method for consistent filtering
          amountUsdt,
          gatewayOrderId: data.result.uuid,
        } as any,
      });

      return reply.send({
        invoiceId: data.result.uuid,
        paymentAddress: data.result.address,
        amountUsdt: data.result.amount,
        currency: data.result.currency,
        network: data.result.network,
        expiresAt: new Date(data.result.expired_at * 1000).toISOString(),
      });
    },
  );
}




