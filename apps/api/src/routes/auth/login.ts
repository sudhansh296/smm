import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  verifyPassword,
  verifyTotpCode,
  verifyBackupCode,
  generateRefreshToken,
  hashRefreshToken,
} from "../../services/auth.service.js";
import {
  UnauthorizedError,
  ValidationError,
  ForbiddenError,
} from "../../lib/errors.js";

const LOCK_TTL = 900; // 15 minutes
const MAX_ATTEMPTS = 5;

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  totpCode: z.string().optional(),
});

export default async function loginRoute(fastify: FastifyInstance) {
  fastify.post("/login", async (request, reply) => {
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError("Invalid credentials");

    const { email, password, totpCode } = parsed.data;
    const lowerEmail = email.trim().toLowerCase();

    // Check account lockout
    const lockKey = `session:lock:${lowerEmail}`;
    const locked = await fastify.redis.get(lockKey);
    if (locked) {
      throw new UnauthorizedError(
        "Account temporarily locked due to too many failed attempts. Try again in 15 minutes.",
      );
    }

    // Fetch user
    const user = await fastify.prisma.user.findUnique({
      where: { email: lowerEmail },
    });

    const incrementFailedAttempts = async () => {
      const attemptsKey = `rl:login:${lowerEmail}`;
      const attempts = await fastify.redis.incr(attemptsKey);
      await fastify.redis.expire(attemptsKey, LOCK_TTL);
      if (attempts >= MAX_ATTEMPTS) {
        await fastify.redis.set(lockKey, "1", "EX", LOCK_TTL);
        if (user) {
          await fastify.prisma.user.update({
            where: { id: user.id },
            data: { lockedUntil: new Date(Date.now() + LOCK_TTL * 1000) },
          });
        }
      }
    };

    if (!user || !user.passwordHash) {
      await incrementFailedAttempts();
      throw new UnauthorizedError("Invalid email or password");
    }

    if (user.isSuspended) throw new ForbiddenError("Account is suspended");

    // Fix: also check DB lockedUntil  --  Redis lock only survives Redis uptime
    // DB lock survives Redis restart/flush
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new UnauthorizedError(`Account temporarily locked. Try again in ${minutesLeft} minute(s).`);
    }

    // Verify password
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      await incrementFailedAttempts();
      throw new UnauthorizedError("Invalid email or password");
    }

    if (!user.emailVerified && process.env["NODE_ENV"] === "production") {
      throw new UnauthorizedError("Please verify your email before logging in");
    }

    // TOTP check
    if (user.totpEnabled) {
      if (!totpCode) {
        return reply.status(200).send({ requiresTotpCode: true });
      }

      // Try TOTP code first
      let totpValid = false;
      if (user.totpSecretEncrypted) {
        totpValid = verifyTotpCode(user.totpSecretEncrypted, totpCode);
      }

      // If TOTP fails, try backup code
      if (!totpValid) {
        const backupCodeId = await verifyBackupCode(fastify.prisma, user.id, totpCode);
        if (backupCodeId) {
          // Backup code already atomically consumed inside verifyBackupCode()
          totpValid = true;
        }
      }

      if (!totpValid) {
        await incrementFailedAttempts();
        throw new UnauthorizedError("Invalid 2FA code");
      }
    }

    // Clear failed attempts
    await fastify.redis.del(`rl:login:${lowerEmail}`);
    await fastify.redis.del(lockKey);

    // Issue access token
    const accessToken = fastify.jwt.sign(
      { sub: user.id, isAdmin: user.isAdmin } as Parameters<typeof fastify.jwt.sign>[0],
    );

    // Issue refresh token
    const rawRefresh = generateRefreshToken();
    const tokenHash = hashRefreshToken(rawRefresh);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await fastify.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    reply.setCookie("refreshToken", rawRefresh, {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    // HttpOnly access token cookie  --  not readable by browser JS (XSS protection)
    reply.setCookie("accessToken", accessToken, {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 900,
    });

    // Issue 8 fix: do NOT return accessToken in body.
    // HttpOnly cookie is the secure transport. API v2 clients that need
    // a token should use the Authorization header via /api/v2 with their API key.
    return reply.send({
      expiresIn: 900,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        isAdmin: user.isAdmin,
        totpEnabled: user.totpEnabled,
      },
    });
  });
}
