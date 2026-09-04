import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

const CACHE_KEY = "maintenance:mode";
const CACHE_TTL = 30; // seconds

export default fp(async (fastify: FastifyInstance) => {
  fastify.addHook("onRequest", async (request, reply) => {
    const path = request.url;
    if (path.startsWith("/webhooks/")) return;

    // Check Redis cache first (fast path)
    const cached = await fastify.redis.get(CACHE_KEY);
    let maintenanceMode: boolean;

    if (cached !== null) {
      maintenanceMode = cached === "1";
    } else {
      const settings = await fastify.prisma.siteSettings.findUnique({
        where: { id: "singleton" },
        select: { maintenanceMode: true },
      });
      maintenanceMode = settings?.maintenanceMode ?? false;
      await fastify.redis.set(CACHE_KEY, maintenanceMode ? "1" : "0", "EX", CACHE_TTL);
    }

    if (!maintenanceMode) return;

    // Allow admins through — use jwtVerify() (NEVER jwt.decode which skips verification)
    try {
      await request.jwtVerify();
      // JWT is valid — now verify admin status against DB (not just JWT claim)
      const userId = (request.user as { sub: string }).sub;
      const dbUser = await fastify.prisma.user.findUnique({
        where: { id: userId },
        select: { isAdmin: true, isSuspended: true },
      });
      if (dbUser?.isAdmin && !dbUser.isSuspended) return;
    } catch {
      // Not authenticated or invalid token — fall through to 503
    }

    return reply.status(503).send({
      error: "Panel is under maintenance. Please try again later.",
      code: "MAINTENANCE",
    });
  });
});