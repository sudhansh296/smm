import type { FastifyInstance } from "fastify";
import { hashRefreshToken } from "../../services/auth.service.js";

export default async function logoutRoute(fastify: FastifyInstance) {
  fastify.post(
    "/logout",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const rawToken = request.cookies["refreshToken"];
      if (rawToken) {
        const tokenHash = hashRefreshToken(rawToken);
        await fastify.prisma.refreshToken.updateMany({
          where: { tokenHash, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      reply.clearCookie("refreshToken", { path: "/" });
      reply.clearCookie("accessToken", { path: "/" });
      return reply.send({ message: "Logged out successfully" });
    },
  );
}
