import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createHash, randomBytes } from "crypto";
import { hashPassword } from "../../services/auth.service.js";
import { sendPasswordResetEmail } from "../../lib/email.js";
import { ValidationError } from "../../lib/errors.js";

// Hash token for storage — never store plaintext reset tokens
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export default async function passwordResetRoute(fastify: FastifyInstance) {
  fastify.post("/forgot-password", async (request, reply) => {
    const { email } = z.object({ email: z.string().email() }).parse(request.body);

    const user = await fastify.prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    // Always respond OK — prevents email enumeration
    if (user) {
      // Invalidate existing tokens
      await fastify.prisma.passwordReset.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      // Generate random token — send raw to user, store only hash
      const rawToken = randomBytes(32).toString("hex"); // 64 hex chars
      const tokenHash = hashToken(rawToken);

      await fastify.prisma.passwordReset.create({
        data: {
          userId: user.id,
          token: tokenHash,          // stored as SHA-256 hash
          expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        },
      });

      // Send raw token in email link — user submits this, we hash and compare
      sendPasswordResetEmail(user.email, user.displayName, rawToken).catch((err) =>
        fastify.log.error({ err }, "Failed to send password reset email"),
      );
    }

    return reply.send({
      message: "If this email is registered, a password reset link has been sent.",
    });
  });

  fastify.post("/reset-password", async (request, reply) => {
    const { token, password } = z.object({
      token: z.string().min(1),
      password: z.string().min(8, "Password must be at least 8 characters").max(128),
    }).parse(request.body);

    // Hash the submitted token and look up by hash
    const tokenHash = hashToken(token);

    const record = await fastify.prisma.passwordReset.findUnique({
      where: { token: tokenHash },
    });

    if (!record || record.usedAt) {
      throw new ValidationError("Invalid or already used reset token");
    }
    if (record.expiresAt < new Date()) {
      throw new ValidationError("Reset token has expired. Please request a new one.");
    }

    const passwordHash = await hashPassword(password);

    await fastify.prisma.$transaction([
      fastify.prisma.passwordReset.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      fastify.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      // Revoke all refresh tokens — all sessions invalidated on password change
      fastify.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return reply.send({ message: "Password reset successfully. Please log in." });
  });
}