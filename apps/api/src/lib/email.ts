import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env.js";

let transporter: Transporter | null = null;

async function getTransporter(): Promise<Transporter> {
  if (transporter) return transporter;

  // In development with placeholder SMTP creds, create an Ethereal test account
  const isDev = env.NODE_ENV === "development";
  const hasRealSmtp =
    env.SMTP_USER &&
    !env.SMTP_USER.includes("ethereal") &&
    env.SMTP_PASSWORD &&
    env.SMTP_PASSWORD !== "your_ethereal_password";

  if (isDev && !hasRealSmtp) {
    try {
      const testAccount = await nodemailer.createTestAccount();
      console.log("[EMAIL] Ethereal test email account created:");
      console.log("   User:", testAccount.user);
      console.log("   Pass:", testAccount.pass);
      console.log("   View emails at: https://ethereal.email");

      transporter = nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        auth: { user: testAccount.user, pass: testAccount.pass },
      });
      return transporter;
    } catch {
      // Fallback  --  just log emails to console
      console.warn("[WARN]  Could not create Ethereal account. Emails will be logged to console.");
      transporter = nodemailer.createTransport({ jsonTransport: true });
      return transporter;
    }
  }

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  });

  return transporter;
}

export async function sendVerificationEmail(
  to: string,
  displayName: string,
  token: string,
): Promise<void> {
  const t = await getTransporter();
  const verifyUrl = `${env.FRONTEND_URL}/verify-email?token=${token}`;

  // Always log verify URL in dev so testing works without real SMTP
  if (env.NODE_ENV === "development") {
    console.log("=".repeat(60));
    console.log("[EMAIL] VERIFY URL for", to);
    console.log(verifyUrl);
    console.log("=".repeat(60));
  }

  try {
    const info = await t.sendMail({
      from: env.SMTP_FROM,
      to,
      subject: "Verify your NexusSMM account",
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
          <h2>Welcome to NexusSMM, ${displayName}!</h2>
          <p>Please verify your email address to activate your account.</p>
          <a href="${verifyUrl}"
             style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;
                    text-decoration:none;border-radius:6px;font-weight:600">
            Verify Email
          </a>
          <p style="color:#64748b;font-size:13px;margin-top:24px">
            Or copy this link: ${verifyUrl}
          </p>
        </div>
      `,
    });
    if (env.NODE_ENV === "development") {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      if (previewUrl) console.log("[EMAIL] Ethereal preview:", previewUrl);
    }
  } catch (err) {
    console.error("[EMAIL] Failed to send verification email:", (err as Error).message);
    // Do not throw -- URL already logged above, user can verify manually in dev
  }
}

export async function sendPasswordResetEmail(
  to: string,
  displayName: string,
  token: string,
): Promise<void> {
  const t = await getTransporter();
  const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${token}`;

  if (env.NODE_ENV === "development") {
    console.log("=".repeat(60));
    console.log("[EMAIL] RESET URL for", to);
    console.log(resetUrl);
    console.log("=".repeat(60));
  }

  try {
    const info = await t.sendMail({
      from: env.SMTP_FROM,
      to,
      subject: "Reset your NexusSMM password",
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
          <h2>Password Reset Request</h2>
          <p>Hi ${displayName}, we received a request to reset your password.</p>
          <a href="${resetUrl}"
             style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;
                    text-decoration:none;border-radius:6px;font-weight:600">
            Reset Password
          </a>
          <p style="color:#64748b;font-size:13px;margin-top:24px">
            Or copy this link: ${resetUrl}
          </p>
        </div>
      `,
    });
    if (env.NODE_ENV === "development") {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      if (previewUrl) console.log("[EMAIL] Ethereal preview:", previewUrl);
    }
  } catch (err) {
    console.error("[EMAIL] Failed to send reset email:", (err as Error).message);
  }
}
