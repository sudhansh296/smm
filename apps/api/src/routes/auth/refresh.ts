import type { FastifyInstance } from "fastify";
import { hashRefreshToken } from "../../services/auth.service.js";
import { UnauthorizedError } from "../../lib/errors.js";

export default async function refreshRoute(fastify: FastifyInstance) {
  fastify.post("/refresh", async (request, reply) => {
    const rawToken = request.cookies["refreshToken"];
    if (!rawToken) throw new UnauthorizedError("No refresh token");

    const tokenHash = hashRefreshToken(rawToken);

    const stored = await fastify.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, isAdmin: true, isSuspended: true } } },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      reply.clearCookie("refreshToken");
      throw new UnauthorizedError("Invalid or expired refresh token");
    }

    if (stored.user.isSuspended) {
      throw new UnauthorizedError("Account is suspended");
    }

    const accessToken = fastify.jwt.sign(
      { sub: stored.user.id, isAdmin: stored.user.isAdmin } as Parameters<typeof fastify.jwt.sign>[0],
    );

    return reply.send({ accessToken, expiresIn: 900 });
  });
}
