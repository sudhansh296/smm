import type { FastifyInstance } from "fastify";
import adminProvidersRoute from "./providers.js";
import adminServicesRoute from "./services.js";
import adminUsersRoute from "./users.js";
import adminOrdersRoute from "./orders.js";
import adminTransactionsRoute from "./transactions.js";
import adminCurrencyRoute from "./currency.js";
import adminSettingsRoute from "./settings.js";
import adminStatsRoute from "./stats.js";
import adminDepositsRoute from "./deposits.js";

export default async function adminRoutes(fastify: FastifyInstance) {
  await fastify.register(adminProvidersRoute);
  await fastify.register(adminServicesRoute);
  await fastify.register(adminUsersRoute);
  await fastify.register(adminOrdersRoute);
  await fastify.register(adminTransactionsRoute);
  await fastify.register(adminCurrencyRoute);
  await fastify.register(adminSettingsRoute);
  await fastify.register(adminStatsRoute);
  await fastify.register(adminDepositsRoute);
}
