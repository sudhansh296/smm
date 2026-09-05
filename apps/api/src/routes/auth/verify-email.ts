import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createHash, randomBytes } from "crypto";
import { sendVerificationEmail } from "../../lib/email.js";
import { ValidationError } from "../../lib/errors.js";

// Hash token for storage — matches password-reset pattern
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export default async function verifyEmailRoute(fastify: FastifyInstance) {
  // Fix #10: verify token — stored as SHA-256 hash, compare by hash
  // Fix #11: atomic consumption via conditional updateMany
  fastify.post("/verify-email", async (request, reply) => {
    const { token } = z.object({ token: z.string().min(1) }).parse(request.body);

    // Hash submitted token and look up by hash
    const tokenHash = hashToken(token);

    const record = await fastify.prisma.emailVerification.findUnique({
      where: { token: tokenHash },
      include: { user: true },
    });

    if (!record) throw new ValidationError("Invalid verification token");
    if (record.usedAt) throw new ValidationError("Verification token already used");
    if (record.expiresAt < new Date()) throw new ValidationError("Verification token has expired. Please request a new one.");

    // Fix #11: atomic consumption — prevents two concurrent requests both passing
    const consumed = await fastify.prisma.emailVerification.updateMany({
      where: { id: record.id, usedAt: null },  // conditional: only if not yet used
      data: { usedAt: new Date() },
    });

    if (consumed.count === 0) {
      throw new ValidationError("Verification token already used");
    }

    await fastify.prisma.user.update({
      where: { id: record.userId },
      data: { emailVerified: true },
    });

    return reply.send({ message: "Email verified successfully. You can now log in." });
  });

  // Resend verification — generate raw token, store hash
  fastify.post("/resend-verification", async (request, reply) => {
    const { email } = z.object({ email: z.string().email() }).parse(request.body);

    const user = await fastify.prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    // Always return success to prevent email enumeration
    if (!user || user.emailVerified) {
      return reply.send({ message: "If this email is registered, a verification link has been sent." });
    }

    // Invalidate old tokens
    await fastify.prisma.emailVerification.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    // Fix #10: generate raw token, store only SHA-256 hash
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);

    await fastify.prisma.emailVerification.create({
      data: {
        userId: user.id,
        token: tokenHash,  // stored as hash
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    // Send raw token in email — user submits raw, we hash and compare
    sendVerificationEmail(user.email, user.displayName, rawToken).catch((err) =>
      fastify.log.error({ err }, "Failed to resend verification email"),
    );

    return reply.send({ message: "If this email is registered, a verification link has been sent." });
  });
}