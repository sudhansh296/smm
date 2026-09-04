import type { FastifyInstance } from "fastify";
import { z } from "zod";

export default async function manualUsdtDepositRoute(fastify: FastifyInstance) {
  // Get wallet addresses for manual deposit
  fastify.get("/usdt-address", { preHandler: [fastify.authenticate] }, async (_request, reply) => {
    return reply.send({
      trc20: process.env.USDT_WALLET_TRC20 ?? "Not configured — contact admin",
      erc20: process.env.USDT_WALLET_ERC20 ?? "Not configured — contact admin",
      bep20: process.env.USDT_WALLET_BEP20 ?? "Not configured — contact admin",
    });
  });

  // Submit manual USDT deposit
  fastify.post("/manual-usdt", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { amountUsdt, txHash, network } = z.object({
      amountUsdt: z.coerce.number().min(1, "Minimum $1 USDT").max(100000),
      txHash: z.string().min(10, "Enter valid transaction hash"),
      network: z.enum(["TRC20", "ERC20", "BEP20"]).default("TRC20"),
    }).parse(request.body);

    const deposit = await fastify.prisma.depositRequest.create({
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

    return reply.status(201).send({
      depositId: deposit.id,
      message: "USDT deposit submitted. Admin will verify on blockchain and credit your wallet.",
      amountUsdt,
      txHash,
      network,
    });
  });
}

