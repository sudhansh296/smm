import type { Redis } from "ioredis";
import type { PrismaClient } from "@nexussmm/db";
import { computeEffectiveRate, inrToUsd } from "@nexussmm/types";

const REDIS_KEY = "inr:effective_rate";

/**
 * Returns the current effective INR rate (base rate + markup applied).
 * Redis-first with DB fallback. Re-populates cache on miss.
 */
export async function getEffectiveInrRate(
  redis: Redis,
  prisma: PrismaClient,
): Promise<number> {
  const cached = await redis.get(REDIS_KEY);
  if (cached !== null) return parseFloat(cached);

  const settings = await prisma.currencySettings.findUnique({
    where: { id: "singleton" },
  });

  if (!settings) throw new Error("CurrencySettings not initialised. Run seed first.");

  // Use depositMarkupPercent for INR → USD conversion
  const depositMarkup = Number((settings as any).depositMarkupPercent ?? settings.markupPercent);
  const effective = computeEffectiveRate(
    Number(settings.manualInrRate),
    depositMarkup,
  );

  const ttlSeconds = settings.autoUpdateFreq === "hourly" ? 3600 : 86400;
  await redis.set(REDIS_KEY, effective.toString(), "EX", ttlSeconds);

  return effective;
}

/**
 * Updates the INR rate in both DB and Redis.
 * source="manual" → keeps lastFetchedRate unchanged
 * source="auto"   → sets lastFetchedRate + lastFetchedAt
 */
export async function setInrRate(
  redis: Redis,
  prisma: PrismaClient,
  baseRate: number,
  markupPercent: number,
  autoUpdateEnabled: boolean,
  autoUpdateFreq: "hourly" | "daily",
  source: "manual" | "auto",
): Promise<void> {
  const effective = computeEffectiveRate(baseRate, markupPercent);

  await prisma.currencySettings.update({
    where: { id: "singleton" },
    data: {
      manualInrRate: baseRate,
      markupPercent,
      autoUpdateEnabled,
      autoUpdateFreq,
      ...(source === "auto"
        ? { lastFetchedRate: baseRate, lastFetchedAt: new Date() }
        : {}),
    },
  });

  // Invalidate cache immediately
  await redis.del(REDIS_KEY);

  // Re-set with correct TTL
  const ttlSeconds = autoUpdateFreq === "hourly" ? 3600 : 86400;
  await redis.set(REDIS_KEY, effective.toString(), "EX", ttlSeconds);
}

/**
 * Fetches live INR rate from external exchange rate API.
 */
export async function fetchLiveInrRate(apiUrl: string): Promise<number> {
  const res = await fetch(apiUrl);
  if (!res.ok) throw new Error(`Exchange rate API returned ${res.status}`);

  const data = (await res.json()) as { rates?: Record<string, number> };
  const inrRate = data.rates?.["INR"];

  if (!inrRate || isNaN(inrRate)) {
    throw new Error("Invalid INR rate in exchange rate API response");
  }

  return inrRate;
}

export { inrToUsd, computeEffectiveRate };
