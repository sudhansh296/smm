import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { getEffectiveInrRate } from "../../services/currency.service.js";
import { ValidationError } from "../../lib/errors.js";

export default async function manualInrDepositRoute(fastify: FastifyInstance) {
  fastify.post("/manual-inr", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { amountInr, utrNumber, note } = z.object({
      amountInr: z.coerce.number().min(50, "Minimum Rs.50").max(100000),
      utrNumber: z.string().min(6, "Enter valid UTR / Transaction ID").max(50),
      note: z.string().max(200).optional(),
    }).parse(request.body);

    // Fix: normalize UTR — trim whitespace, uppercase for case-insensitive dedup
    utrNumber = utrNumber.trim().toUpperCase();

    // Prevent same UTR being submitted twice — catches accidental double-submission
    const existing = await fastify.prisma.depositRequest.findFirst({
      where: { txId: utrNumber, method: "MANUAL_INR" } as any,
    });
    if (existing) throw new ValidationError("This UTR/Transaction ID has already been submitted");

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