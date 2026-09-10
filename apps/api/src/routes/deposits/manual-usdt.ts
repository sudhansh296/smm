import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ValidationError } from "../../lib/errors.js";

export default async function manualUsdtDepositRoute(fastify: FastifyInstance) {
  // Public endpoint -- no auth needed to show deposit address to user
  fastify.get("/usdt-address", { preHandler: [fastify.authenticate] }, async (_request, reply) => {
    const settings = await fastify.prisma.siteSettings.findUnique({ where: { id: "singleton" } }) as any;

    return reply.send({
      trc20: settings?.usdtTrc20 || process.env["USDT_WALLET_TRC20"] || null,
      erc20: settings?.usdtErc20 || process.env["USDT_WALLET_ERC20"] || null,
      bep20: settings?.usdtBep20 || process.env["USDT_WALLET_BEP20"] || null,
    });
  });

  fastify.post("/manual-usdt", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const parsed = z.object({
      amountUsdt: z.coerce.number().min(1, "Minimum $1 USDT").max(100000),
      txHash:     z.string().min(10, "Enter valid transaction hash").max(100),
      network:    z.enum(["TRC20", "ERC20", "BEP20"]).default("TRC20"),
    }).parse(request.body);

    const amountUsdt = parsed.amountUsdt;
    const network    = parsed.network;
    const txHash     = parsed.txHash.trim().toLowerCase();

    // Atomic duplicate check + create to prevent race condition on same txHash
    let deposit: any;
    try {
      deposit = await fastify.prisma.$transaction(async (tx) => {
        const existing = await tx.depositRequest.findFirst({
          where: { txId: txHash, method: "MANUAL_USDT" } as any,
        });
        if (existing) throw new ValidationError("This transaction hash has already been submitted");

        return tx.depositRequest.create({
          data: {
            userId: request.user.sub,
            gateway: "manual_usdt",
            method: "MANUAL_USDT",
            amountInr: null,
            amountUsdt,
            gatewayOrderId: `manual_usdt_${request.user.sub}_${Date.now()}`,
            txId: txHash,
            adminNote: `Network: ${network}`,
          } as any,
        });
      });
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      throw err;
    }

    return reply.status(201).send({
      depositId: deposit.id,
      message: "USDT deposit submitted. Admin will verify on blockchain and credit your wallet.",
      amountUsdt, txHash, network,
    });
  });
}