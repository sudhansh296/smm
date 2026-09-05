import bcrypt from "bcryptjs";

const { hash, compare } = bcrypt;
import * as OTPAuth from "otpauth";
import { toDataURL } from "qrcode";
import type { PrismaClient } from "@nexussmm/db";
import {
  encryptSecret,
  decryptSecret,
  generateToken,
  hashRefreshToken,
} from "../lib/crypto.js";
import { randomBytes } from "crypto";

const BCRYPT_ROUNDS = 12;
const BACKUP_CODE_COUNT = 8;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  return compare(plain, hashed);
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString("hex"); // 64-char hex
}

/**
 * Generates TOTP secret, QR code URI, and 8 hashed backup codes.
 */
export async function generateTotpEnrollment(
  userId: string,
  email: string,
): Promise<{
  secret: string;
  qrCodeUri: string;
  encryptedSecret: string;
  backupCodes: string[];
  backupCodeHashes: string[];
}> {
  const totp = new OTPAuth.TOTP({
    issuer: "NexusSMM",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });

  const secret = totp.secret.base32;
  const encryptedSecret = encryptSecret(secret);
  const qrCodeUri = await toDataURL(totp.toString());

  // Generate 8 unique backup codes
  const backupCodes: string[] = [];
  const backupCodeHashes: string[] = [];

  while (backupCodes.length < BACKUP_CODE_COUNT) {
    const code = randomBytes(5).toString("hex").toUpperCase(); // 10-char hex
    if (!backupCodes.includes(code)) {
      backupCodes.push(code);
      // Hash backup codes with bcrypt (lower rounds ok — they're 1-time use)
      backupCodeHashes.push(await hash(code, 10));
    }
  }

  return { secret, qrCodeUri, encryptedSecret, backupCodes, backupCodeHashes };
}

/**
 * Verifies a TOTP code against the user's encrypted secret.
 */
export function verifyTotpCode(encryptedSecret: string, code: string): boolean {
  try {
    const secret = decryptSecret(encryptedSecret);
    const totp = new OTPAuth.TOTP({
      issuer: "NexusSMM",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
    // Allow ±1 window (30s drift tolerance)
    const delta = totp.validate({ token: code, window: 1 });
    return delta !== null;
  } catch {
    return false;
  }
}

/**
 * Verifies a backup code against stored hashes. Returns the matching hash index or -1.
 */
export async function verifyBackupCode(
  prisma: PrismaClient,
  userId: string,
  code: string,
): Promise<string | null> {
  const codes = await prisma.totpBackupCode.findMany({
    where: { userId, usedAt: null },
  });
  for (const backupCode of codes) {
    const isMatch = await compare(code, backupCode.codeHash);
    if (isMatch) {
      // Atomic consumption -- two concurrent requests: only one gets count=1
      const consumed = await prisma.totpBackupCode.updateMany({
        where: { id: backupCode.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (consumed.count === 0) return null; // already consumed by concurrent request
      return backupCode.id;
    }
  }
  return null;
}
export { generateToken, hashRefreshToken };
