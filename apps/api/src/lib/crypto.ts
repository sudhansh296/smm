import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "crypto";
import { env } from "./env.js";

const ALGO = "aes-256-gcm";
const KEY = Buffer.from(env.TOTP_ENCRYPTION_KEY, "hex"); // 32 bytes

/**
 * Encrypts a TOTP secret string using AES-256-GCM.
 * Returns: "ivHex:authTagHex:encryptedHex"
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

/**
 * Decrypts a stored AES-256-GCM secret.
 */
export function decryptSecret(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted secret format");
  const [ivHex, authTagHex, encryptedHex] = parts as [string, string, string];
  const decipher = createDecipheriv(ALGO, KEY, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  return (
    decipher.update(Buffer.from(encryptedHex, "hex")).toString("utf8") +
    decipher.final("utf8")
  );
}

/**
 * Generates a cryptographically random API key.
 * Returns raw (64-char hex), SHA-256 hash for storage, and last 8 chars for display.
 */
export function generateApiKey(): { raw: string; hash: string; lastEight: string } {
  const raw = randomBytes(32).toString("hex"); // 64-char hex
  const hash = createHash("sha256").update(raw).digest("hex");
  const lastEight = raw.slice(-8);
  return { raw, hash, lastEight };
}

/**
 * Hashes a refresh token for safe DB storage.
 */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Generates a secure random token (for email verification, password reset etc.)
 */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/**
 * Encrypts a provider API key for DB storage.
 * Uses same AES-256-GCM as TOTP secrets.
 */
export function encryptProviderKey(apiKey: string): string {
  return encryptSecret(apiKey);
}

export function decryptProviderKey(encrypted: string): string {
  return decryptSecret(encrypted);
}
