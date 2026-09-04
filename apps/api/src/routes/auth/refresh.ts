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

    // Detect token reuse — if token was already revoked, someone may be replaying a stolen token
    if (stored && stored.revokedAt) {
      // Revoke ALL sessions for this user as a precaution (token theft likely)
      fastify.log.warn({ userId: stored.userId }, "Refresh token reuse detected — revoking all sessions");
      await fastify.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      reply.clearCookie("refreshToken", { path: "/" });
      throw new UnauthorizedError("Session invalidated. Please log in again.");
    }

    if (!stored || stored.expiresAt < new Date()) {
      reply.clearCookie("refreshToken", { path: "/" });
      throw new UnauthorizedError("Invalid or expired refresh token");
    }

    if (stored.user.isSuspended) {
      reply.clearCookie("refreshToken", { path: "/" });
      throw new UnauthorizedError("Account is suspended");
    }

    // Bug 9 fix: Atomic revoke — only proceeds if token is still active
    // Prevents rotation race condition where two concurrent requests both rotate the same token
    const revoked = await fastify.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (revoked.count === 0) {
      // Another request already rotated this token — treat as reuse
      fastify.log.warn({ userId: stored.userId }, "Refresh token rotation race — treating as reuse");
      await fastify.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      reply.clearCookie("refreshToken", { path: "/" });
      throw new UnauthorizedError("Session invalidated. Please log in again.");
    }

    // Issue new token only after successfully revoking old one
    const newRawToken = generateRefreshToken();
    const newTokenHash = hashRefreshToken(newRawToken);
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await fastify.prisma.refreshToken.create({
      data: {
        userId: stored.user.id,
        tokenHash: newTokenHash,
        expiresAt: newExpiresAt,
      },
    });

    // Bug 8 fix: cookie path changed to "/" so logout and other routes receive it
    reply.setCookie("refreshToken", newRawToken, {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: "strict",
      path: "/",
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
