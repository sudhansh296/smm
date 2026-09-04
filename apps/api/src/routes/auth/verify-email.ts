import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { generateToken } from "../../services/auth.service.js";
import { sendVerificationEmail } from "../../lib/email.js";
import { ValidationError, NotFoundError } from "../../lib/errors.js";

export default async function verifyEmailRoute(fastify: FastifyInstance) {
  // Verify token
  fastify.post("/verify-email", async (request, reply) => {
    const { token } = z.object({ token: z.string().min(1) }).parse(request.body);

    const record = await fastify.prisma.emailVerification.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!record || record.usedAt) {
      throw new ValidationError("Invalid or already used verification token");
    }
    if (record.expiresAt < new Date()) {
      throw new ValidationError("Verification token has expired. Please request a new one.");
    }

    await fastify.prisma.$transaction([
      fastify.prisma.emailVerification.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      fastify.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerified: true },
      }),
    ]);

    return reply.send({ message: "Email verified successfully. You can now log in." });
  });

  // Resend verification
  fastify.post("/resend-verification", async (request, reply) => {
    const { email } = z.object({ email: z.string().email() }).parse(request.body);

    const user = await fastify.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    // Always return success to prevent email enumeration
    if (!user || user.emailVerified) {
      return reply.send({ message: "If this email is registered, a verification link has been sent." });
    }

    // Invalidate old tokens
    await fastify.prisma.emailVerification.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = generateToken();
    await fastify.prisma.emailVerification.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    sendVerificationEmail(user.email, user.displayName, token).catch((err) =>
      fastify.log.error({ err }, "Failed to resend verification email"),
    );

    return reply.send({ message: "If this email is registered, a verification link has been sent." });
  });
}
