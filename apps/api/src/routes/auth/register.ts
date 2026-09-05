import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createHash, randomBytes } from "crypto";
import { hashPassword } from "../../services/auth.service.js";
import { sendVerificationEmail } from "../../lib/email.js";
import { ConflictError, ValidationError } from "../../lib/errors.js";

/**
 * Shared helper: generate raw verification token, store SHA-256 hash in DB.
 * Returns rawToken (for email) and record.
 * Used by both registration and resend-verification.
 */
export async function createEmailVerificationToken(
  prisma: { emailVerification: { updateMany: Function; create: Function } },
  userId: string,
): Promise<string> {
  // Invalidate any existing unused tokens
  await prisma.emailVerification.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  await prisma.emailVerification.create({
    data: {
      userId,
      token: tokenHash,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  return rawToken; // send this in email, store only hash
}

const schema = z.object({
  email: z.string().email("Invalid email"),
  displayName: z.string().min(2).max(50),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

export default async function registerRoute(fastify: FastifyInstance) {
  fastify.post("/register", async (request, reply) => {
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.errors[0]?.message ?? "Invalid input");
    }

    const { email, displayName, password } = parsed.data;
    const lowerEmail = email.toLowerCase();

    const existing = await fastify.prisma.user.findUnique({ where: { email: lowerEmail } });
    if (existing) throw new ConflictError("An account with this email already exists");

    const passwordHash = await hashPassword(password);

    const user = await fastify.prisma.user.create({
      data: { email: lowerEmail, displayName, passwordHash, walletBalance: 0 },
    });

    // Fix #1: use shared helper — stores SHA-256 hash, sends raw token in email
    const rawToken = await createEmailVerificationToken(fastify.prisma as any, user.id);

    sendVerificationEmail(lowerEmail, displayName, rawToken).catch((err) =>
      fastify.log.error({ err }, "Failed to send verification email"),
    );

    return reply.status(201).send({
      message: "Account created. Please check your email to verify your account.",
      userId: user.id,
    });
  });
}