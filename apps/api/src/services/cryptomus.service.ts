import { createHash } from "crypto";
import { env } from "../lib/env.js";

export function cryptomusSign(payload: Record<string, unknown>): string {
  return createHash("md5")
    .update(Buffer.from(JSON.stringify(payload)).toString("base64") + env.CRYPTOMUS_API_KEY)
    .digest("hex");
}

export async function cryptomusRequest(
  path: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const sign = cryptomusSign(payload);
  const res = await fetch(`https://api.cryptomus.com/v1${path}`, {
    method: "POST",
    headers: {
      "merchant": env.CRYPTOMUS_MERCHANT_ID,
      "sign": sign,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

export interface CryptomusInvoiceResult {
  uuid: string;
  address: string | null;
  amount: string;
  currency: string;
  network: string;
  url: string | null;
  expired_at: number;
}
