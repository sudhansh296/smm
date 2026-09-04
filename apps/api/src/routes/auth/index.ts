import type { FastifyInstance } from "fastify";
import registerRoute from "./register.js";
import loginRoute from "./login.js";
import logoutRoute from "./logout.js";
import refreshRoute from "./refresh.js";
import verifyEmailRoute from "./verify-email.js";
import passwordResetRoute from "./password-reset.js";
import totpRoute from "./totp.js";

export default async function authRoutes(fastify: FastifyInstance) {
  await fastify.register(registerRoute);
  await fastify.register(loginRoute);
  await fastify.register(logoutRoute);
  await fastify.register(refreshRoute);
  await fastify.register(verifyEmailRoute);
  await fastify.register(passwordResetRoute);
  await fastify.register(totpRoute);
}
