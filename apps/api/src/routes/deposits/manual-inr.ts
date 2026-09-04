import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { getEffectiveInrRate } from "../../services/currency.service.js";

export default async function manualInrDepositRoute(fastify: FastifyInstance) {
  fastify.post("/manual-inr", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { amountInr, utrNumber, note } = z.object({
      amountInr: z.coerce.number().min(50, "Minimum ₹50").max(100000),
      utrNumber: z.string().min(6, "Enter valid UTR / Transaction ID"),
      note: z.string().optional(),
    }).parse(request.body);

    const effectiveRate = await getEffectiveInrRate(fastify.redis, fastify.prisma);
    const amountUsd = new Decimal(amountInr).dividedBy(effectiveRate).toDecimalPlaces(8);

    const deposit = await fastify.prisma.depositRequest.create({
      data: {
        userId: request.user.sub,
        gateway: "manual_inr",
        method: "MANUAL_INR",
        amountInr,
        amountUsdt: null,
        gatewayOrderId: `manual_inr_${request.user.sub}_${Date.now()}`,
        inrRateSnapshot: new Decimal(effectiveRate).toDecimalPlaces(4).toNumber(),
        txId: utrNumber,
        adminNote: note ?? null,
      } as any,
    });

    return reply.status(201).send({
      depositId: deposit.id,
      message: "Deposit request submitted. Admin will verify and credit your wallet within 24 hours.",
      amountInr,
      amountUsd: amountUsd.toFixed(2),
      utrNumber,
    });
  });
}

