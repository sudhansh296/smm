import type { FastifyInstance } from "fastify";
import profileRoute from "./profile.js";
import walletRoute from "./wallet.js";
import transactionsRoute from "./transactions.js";
import apiKeyRoute from "./api-key.js";
import userOrdersRoute from "./orders.js";
import notificationsRoute from "./notifications.js";
import userDepositsRoute from "./deposits.js";

export default async function userRoutes(fastify: FastifyInstance) {
  await fastify.register(profileRoute);
  await fastify.register(walletRoute);
  await fastify.register(transactionsRoute);
  await fastify.register(apiKeyRoute);
  await fastify.register(userOrdersRoute);
  await fastify.register(notificationsRoute);
  await fastify.register(userDepositsRoute);
}
