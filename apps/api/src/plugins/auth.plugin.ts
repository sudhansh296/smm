import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import { env } from "../lib/env.js";
import { UnauthorizedError, ForbiddenError } from "../lib/errors.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
    authenticateAdmin: (request: FastifyRequest) => Promise<void>;
  }
}

export default fp(async (fastify: FastifyInstance) => {
  await fastify.register(fastifyCookie, {
    secret: env.COOKIE_SECRET,
    hook: "onRequest",
  });

  await fastify.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    cookie: { cookieName: "accessToken", signed: false },
    sign: { expiresIn: "15m" },
  });

  fastify.decorate("authenticate", async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch {
      throw new UnauthorizedError("Invalid or expired token");
    }
    // Verify user is still active in DB
    const dbUser = await fastify.prisma.user.findUnique({
      where: { id: request.user.sub },
      select: { isSuspended: true },
    });
    if (!dbUser || dbUser.isSuspended) throw new ForbiddenError("Account is suspended");
  });

  fastify.decorate("authenticateAdmin", async (request: FastifyRequest) => {
    await fastify.authenticate(request);
    // Always verify admin status from DB — never trust JWT claim alone
    // This ensures revoked admins lose access immediately (not after token expiry)
    const dbUser = await fastify.prisma.user.findUnique({
      where: { id: request.user.sub },
      select: { isAdmin: true, isSuspended: true },
    });
    if (!dbUser || !dbUser.isAdmin || dbUser.isSuspended) {
      throw new ForbiddenError("Admin access required");
    }
  });
});