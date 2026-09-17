import type { FastifyInstance } from "fastify";
import { env } from "../../lib/env.js";
import razorpayDeposit from "./razorpay.js";
import cryptomusDeposit from "./cryptomus.js";
import manualInrDeposit from "./manual-inr.js";
import manualUsdtDeposit from "./manual-usdt.js";

export default async function depositRoutes(fastify: FastifyInstance) {
  await fastify.register(razorpayDeposit);
  await fastify.register(cryptomusDeposit);
  await fastify.register(manualInrDeposit);
  await fastify.register(manualUsdtDeposit);

  // Tells the frontend which gateway tabs to show on the deposit pages
  fastify.get("/config", { preHandler: [fastify.authenticate] }, async (_request, reply) => {
    return reply.send({
      razorpayEnabled: env.RAZORPAY_MODE !== "disabled",
      cryptomusEnabled: env.CRYPTOMUS_MODE !== "disabled",
    });
  });
}
