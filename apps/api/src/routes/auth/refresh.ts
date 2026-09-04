import type { FastifyInstance } from "fastify";
import { hashRefreshToken, generateRefreshToken } from "../../services/auth.service.js";
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

    // Detect token reuse â€” if token was already revoked, someone may be replaying a stolen token
    if (stored && stored.revokedAt) {
      // Revoke ALL sessions for this user as a precaution (token theft likely)
      fastify.log.warn({ userId: stored.userId }, "Refresh token reuse detected â€” revoking all sessions");
      await fastify.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      reply.clearCookie("refreshToken", { path: "/auth/refresh" });
      throw new UnauthorizedError("Session invalidated. Please log in again.");
    }

    if (!stored || stored.expiresAt < new Date()) {
      reply.clearCookie("refreshToken", { path: "/auth/refresh" });
      throw new UnauthorizedError("Invalid or expired refresh token");
    }

    if (stored.user.isSuspended) {
      reply.clearCookie("refreshToken", { path: "/auth/refresh" });
      throw new UnauthorizedError("Account is suspended");
    }

    // Refresh token rotation â€” revoke old token, issue new one
    const newRawToken = generateRefreshToken();
    const newTokenHash = hashRefreshToken(newRawToken);
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await fastify.prisma.$transaction([
      // Revoke the used token
      fastify.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      }),
      // Issue replacement token
      fastify.prisma.refreshToken.create({
        data: {
          userId: stored.user.id,
          tokenHash: newTokenHash,
          expiresAt: newExpiresAt,
        },
      }),
    ]);

    // Set new refresh token cookie
    reply.setCookie("refreshToken", newRawToken, {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: "strict",
      path: "/auth/refresh",
      maxAge: 7 * 24 * 60 * 60,
    });

    const accessToken = fastify.jwt.sign(
      { sub: stored.user.id, isAdmin: stored.user.isAdmin } as Parameters<typeof fastify.jwt.sign>[0],
    );

    // Re-set HttpOnly access token cookie on each refresh
    reply.setCookie("accessToken", accessToken, {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 900,
    });

    return reply.send({ accessToken, expiresIn: 900 });
  });
}