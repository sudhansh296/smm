import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashPassword, generateToken } from "../../services/auth.service.js";
import { sendPasswordResetEmail } from "../../lib/email.js";
import { ValidationError } from "../../lib/errors.js";

export default async function passwordResetRoute(fastify: FastifyInstance) {
  // Request reset
  fastify.post("/forgot-password", async (request, reply) => {
    const { email } = z.object({ email: z.string().email() }).parse(request.body);

    const user = await fastify.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    // Always respond OK — prevents email enumeration
    if (user) {
      // Invalidate existing tokens
      await fastify.prisma.passwordReset.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      const token = generateToken();
      await fastify.prisma.passwordReset.create({
        data: {
          userId: user.id,
          token,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        },
      });

      sendPasswordResetEmail(user.email, user.displayName, token).catch((err) =>
        fastify.log.error({ err }, "Failed to send password reset email"),
      );
    }

    return reply.send({
      message: "If this email is registered, a password reset link has been sent.",
    });
  });

  // Submit new password
  fastify.post("/reset-password", async (request, reply) => {
    const { token, password } = z
      .object({
        token: z.string().min(1),
        password: z.string().min(8, "Password must be at least 8 characters").max(128),
      })
      .parse(request.body);

    const record = await fastify.prisma.passwordReset.findUnique({
      where: { token },
    });

    if (!record || record.usedAt) {
      throw new ValidationError("Invalid or already used reset token");
    }
    if (record.expiresAt < new Date()) {
      throw new ValidationError("Reset token has expired. Please request a new one.");
    }

    const passwordHash = await hashPassword(password);

    await fastify.prisma.$transaction([
      // Mark token used
      fastify.prisma.passwordReset.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // Update password
      fastify.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      // Revoke all refresh tokens (security — all sessions invalidated)
      fastify.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return reply.send({ message: "Password reset successfully. Please log in." });
  });
}
