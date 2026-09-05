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

    // Fix #5: distinguish genuine reuse from multi-tab race using a grace window.
    // A 30-second window covers normal concurrent browser requests without being
    // exploitable (attacker would need to replay within 30s of honest rotation).
    if (stored && stored.revokedAt) {
      const secondsSinceRevoke = (Date.now() - stored.revokedAt.getTime()) / 1000;

      if (secondsSinceRevoke <= 30) {
        // Within grace window — almost certainly a multi-tab race, not an attack.
        // Return 401 so client retries with the new cookie from the winning request.
        fastify.log.debug({ userId: stored.userId, secondsSinceRevoke },
          "Refresh token race (within grace window) — returning 401 for retry");
        throw new UnauthorizedError("Token rotated by concurrent request — please retry");
      }

      // Outside grace window — token used long after rotation completed → security event
      fastify.log.warn({ userId: stored.userId, secondsSinceRevoke },
        "Refresh token reuse detected outside grace window — revoking all sessions");
      await fastify.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      reply.clearCookie("refreshToken", { path: "/" });
      reply.clearCookie("accessToken", { path: "/" });
      throw new UnauthorizedError("Session invalidated due to suspicious activity. Please log in again.");
    }

    if (!stored || stored.expiresAt < new Date()) {
      reply.clearCookie("refreshToken", { path: "/" });
      throw new UnauthorizedError("Invalid or expired refresh token");
    }

    if (stored.user.isSuspended) {
      reply.clearCookie("refreshToken", { path: "/" });
      throw new UnauthorizedError("Account is suspended");
    }

    // Issue 6 fix: atomic revoke — only the first concurrent request wins.
    // If two tabs hit refresh simultaneously with the same token, one wins
    // and the other gets a clean 401 (not a full session nuke).
    // The losing request's browser will retry and get the new cookie from the winner.
    const revoked = await fastify.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (revoked.count === 0) {
      // Another concurrent request already rotated this token.
      // This is NOT a security event — it's a race between two honest requests.
      // Return 401 so the client retries; it will get new cookies from the winning request.
      fastify.log.debug({ userId: stored.userId }, "Refresh rotation race — other request already rotated, returning 401");
      throw new UnauthorizedError("Token already rotated — please retry");
    }

    // Issue new token only after successfully revoking old one
    const newRawToken = generateRefreshToken();
    const newTokenHash = hashRefreshToken(newRawToken);
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await fastify.prisma.refreshToken.create({
      data: { userId: stored.user.id, tokenHash: newTokenHash, expiresAt: newExpiresAt },
    });

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

    reply.setCookie("accessToken", accessToken, {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 900,
    });

    // Issue 8 fix: do NOT return accessToken in body
    // Frontend uses HttpOnly cookie via withCredentials — body token is a security leak
    return reply.send({ expiresIn: 900 });
  });
}