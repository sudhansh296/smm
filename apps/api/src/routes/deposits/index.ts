import type { FastifyInstance } from "fastify";
import razorpayDeposit from "./razorpay.js";
import cryptomusDeposit from "./cryptomus.js";
import manualInrDeposit from "./manual-inr.js";
import manualUsdtDeposit from "./manual-usdt.js";

export default async function depositRoutes(fastify: FastifyInstance) {
  await fastify.register(razorpayDeposit);
  await fastify.register(cryptomusDeposit);
  await fastify.register(manualInrDeposit);
  await fastify.register(manualUsdtDeposit);
}
