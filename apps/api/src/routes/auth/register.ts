import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashPassword, generateToken } from "../../services/auth.service.js";
import { sendVerificationEmail } from "../../lib/email.js";
import { ConflictError, ValidationError } from "../../lib/errors.js";

const schema = z.object({
  email: z.string().email("Invalid email"),
  displayName: z.string().min(2).max(50),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128),
});

export default async function registerRoute(fastify: FastifyInstance) {
  fastify.post("/register", async (request, reply) => {
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.errors[0]?.message ?? "Invalid input");
    }

    const { email, displayName, password } = parsed.data;
    const lowerEmail = email.toLowerCase();

    // Check duplicate
    const existing = await fastify.prisma.user.findUnique({
      where: { email: lowerEmail },
    });
    if (existing) throw new ConflictError("An account with this email already exists");

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    const user = await fastify.prisma.user.create({
      data: {
        email: lowerEmail,
        displayName,
        passwordHash,
        walletBalance: 0,
      },
    });

    // Create email verification token (24h)
    const token = generateToken();
    await fastify.prisma.emailVerification.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    // Send verification email (non-blocking)
    sendVerificationEmail(lowerEmail, displayName, token).catch((err) =>
      fastify.log.error({ err }, "Failed to send verification email"),
    );

    return reply.status(201).send({
      message: "Account created. Please check your email to verify your account.",
      userId: user.id,
    });
  });
}
