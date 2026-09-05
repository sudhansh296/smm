import { z } from "zod";
import { config } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Load .env from monorepo root (works from any subdirectory)
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../../../../.env") });
config({ path: resolve(__dirname, "../../../../.env") });
config({ path: resolve(__dirname, "../../../.env") });
config({ path: resolve(process.cwd(), ".env") });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  // JWT
  JWT_SECRET: z.string().min(32),
  COOKIE_SECRET: z.string().min(32),

  // TOTP encryption
  TOTP_ENCRYPTION_KEY: z.string().length(64).regex(/^[0-9a-fA-F]{64}$/, "Must be 64 hex characters (32 bytes)"), // 32-byte hex

  // Google OAuth (optional — feature not yet implemented)
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),

  // Email (SMTP) — optional in dev (Ethereal fallback), required in production
  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASSWORD: z.string().optional().default(""),
  SMTP_FROM: z.string().optional().default("NexusSMM <noreply@example.com>"),

  // API base URL for webhook callbacks
  API_BASE_URL: z.string().url().optional(),

  // Razorpay
  RAZORPAY_KEY_ID: z.string().default("mock"),
  RAZORPAY_KEY_SECRET: z.string().default("mock"),
  RAZORPAY_WEBHOOK_SECRET: z.string().default("mock"),

  // Cryptomus
  CRYPTOMUS_API_KEY: z.string().default("mock"),
  CRYPTOMUS_MERCHANT_ID: z.string().default("mock"),

  // Exchange Rate API
  EXCHANGE_RATE_API_URL: z
    .string()
    .url()
    .default("https://api.exchangerate-api.com/v4/latest/USD"),

  // App
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  WORKER_MODE: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("âŒ Invalid environment variables:");
    for (const [key, issues] of Object.entries(result.error.flatten().fieldErrors)) {
      console.error(`  ${key}: ${issues?.join(", ")}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const env = validateEnv();

