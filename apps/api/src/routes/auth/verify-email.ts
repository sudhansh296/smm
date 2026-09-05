import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createHash } from "crypto";
import { sendVerificationEmail } from "../../lib/email.js";
import { ValidationError } from "../../lib/errors.js";
import { createEmailVerificationToken } from "./register.js";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export default async function verifyEmailRoute(fastify: FastifyInstance) {
  fastify.post("/verify-email", async (request, reply) => {
    const { token } = z.object({ token: z.string().min(1) }).parse(request.body);
    const tokenHash = hashToken(token);

    const record = await fastify.prisma.emailVerification.findUnique({
      where: { token: tokenHash },
    });

    if (!record) throw new ValidationError("Invalid verification token");
    if (record.usedAt) throw new ValidationError("Verification token already used");
    if (record.expiresAt < new Date()) throw new ValidationError("Verification token has expired. Please request a new one.");

    // Fix #6: token consume + user verification in ONE transaction
    // Previously: two separate DB calls  --  crash between them = token used but email unverified
    await fastify.prisma.$transaction(async (tx) => {
      const consumed = await tx.emailVerification.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      if (consumed.count === 0) {
        throw new ValidationError("Verification token already used");
      }

      await tx.user.update({
        where: { id: record.userId },
        data: { emailVerified: true },
      });
    });

    return reply.send({ message: "Email verified successfully. You can now log in." });
  });

  // Fix #1: resend uses same shared helper as registration
  fastify.post("/resend-verification", async (request, reply) => {
    const { email } = z.object({ email: z.string().trim().toLowerCase().email() }).parse(request.body);

    const user = await fastify.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });

    if (!user || user.emailVerified) {
      return reply.send({ message: "If this email is registered, a verification link has been sent." });
    }

    const rawToken = await createEmailVerificationToken(fastify.prisma as any, user.id);

    sendVerificationEmail(user.email, user.displayName, rawToken).catch((err) =>
      fastify.log.error({ err }, "Failed to resend verification email"),
    );

    return reply.send({ message: "If this email is registered, a verification link has been sent." });
  });
}