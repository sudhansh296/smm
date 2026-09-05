import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  generateTotpEnrollment,
  verifyTotpCode,
  verifyBackupCode,
} from "../../services/auth.service.js";
import { ValidationError, ForbiddenError } from "../../lib/errors.js";

export default async function totpRoute(fastify: FastifyInstance) {
  // Begin TOTP enrollment  --  generates secret once and stores encrypted
  fastify.post(
    "/totp/enroll",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user.sub;
      const user = await fastify.prisma.user.findUniqueOrThrow({ where: { id: userId } });

      if (user.totpEnabled) {
        throw new ValidationError("2FA is already enabled on this account");
      }

      const enrollment = await generateTotpEnrollment(userId, user.email);

      // Store encrypted secret temporarily in DB  --  not yet confirmed
      await fastify.prisma.user.update({
        where: { id: userId },
        data: { totpSecretEncrypted: enrollment.encryptedSecret },
      });

      return reply.send({
        secret: enrollment.secret,
        qrCodeUri: enrollment.qrCodeUri,
      });
    },
  );

  // Confirm TOTP enrollment  --  verifies OTP against the SAME secret stored during enroll
  fastify.post(
    "/totp/verify",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { code } = z.object({ code: z.string().length(6) }).parse(request.body);
      const userId = request.user.sub;

      const user = await fastify.prisma.user.findUniqueOrThrow({ where: { id: userId } });

      if (!user.totpSecretEncrypted) {
        throw new ValidationError("Start TOTP enrollment first via /totp/enroll");
      }
      if (user.totpEnabled) {
        throw new ValidationError("2FA is already enabled");
      }

      // Verify OTP against the SAME secret stored during enrollment  --  never regenerate here
      const valid = verifyTotpCode(user.totpSecretEncrypted, code);
      if (!valid) throw new ValidationError("Invalid 2FA code  --  check your authenticator app");

      // Only NOW generate backup codes (enrollment secret stays the same)
      const { backupCodes, backupCodeHashes } = await generateBackupCodes();

      await fastify.prisma.$transaction([
        fastify.prisma.user.update({
          where: { id: userId },
          data: {
            totpEnabled: true,
            // totpSecretEncrypted stays as-is  --  DO NOT overwrite
          },
        }),
        fastify.prisma.totpBackupCode.deleteMany({ where: { userId } }),
        fastify.prisma.totpBackupCode.createMany({
          data: backupCodeHashes.map((codeHash: string) => ({ userId, codeHash })),
        }),
      ]);

      return reply.send({
        message: "2FA enabled successfully",
        backupCodes, // Shown once  --  user must save these
      });
    },
  );

  // Disable TOTP  --  requires current TOTP code or a valid backup code
  fastify.post(
    "/totp/disable",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { code } = z.object({ code: z.string().min(6) }).parse(request.body);
      const userId = request.user.sub;

      const user = await fastify.prisma.user.findUniqueOrThrow({ where: { id: userId } });

      if (!user.totpEnabled || !user.totpSecretEncrypted) {
        throw new ValidationError("2FA is not enabled");
      }

      let valid = verifyTotpCode(user.totpSecretEncrypted, code);

      if (!valid) {
        const backupId = await verifyBackupCode(fastify.prisma, userId, code);
        if (backupId) {
          await fastify.prisma.totpBackupCode.update({
            where: { id: backupId },
            data: { usedAt: new Date() },
          });
          valid = true;
        }
      }

      if (!valid) throw new ForbiddenError("Invalid 2FA code or backup code");

      await fastify.prisma.$transaction([
        fastify.prisma.user.update({
          where: { id: userId },
          data: { totpEnabled: false, totpSecretEncrypted: null },
        }),
        fastify.prisma.totpBackupCode.deleteMany({ where: { userId } }),
      ]);

      return reply.send({ message: "2FA disabled successfully" });
    },
  );
}

// Separate backup code generation  --  does NOT touch TOTP secret
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
async function generateBackupCodes(): Promise<{ backupCodes: string[]; backupCodeHashes: string[] }> {
  const backupCodes: string[] = [];
  const backupCodeHashes: string[] = [];
  while (backupCodes.length < 8) {
    const code = randomBytes(5).toString("hex").toUpperCase();
    if (!backupCodes.includes(code)) {
      backupCodes.push(code);
      backupCodeHashes.push(await bcrypt.hash(code, 10));
    }
  }
  return { backupCodes, backupCodeHashes };
}