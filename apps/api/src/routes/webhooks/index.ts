import type { FastifyInstance } from "fastify";
import razorpayWebhook from "./razorpay.js";
import cryptomusWebhook from "./cryptomus.js";

export default async function webhookRoutes(fastify: FastifyInstance) {
  await fastify.register(razorpayWebhook);
  await fastify.register(cryptomusWebhook);
}
