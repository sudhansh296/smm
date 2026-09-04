import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import type { PrismaClient } from "@nexussmm/db";
import {
  fetchLiveInrRate,
  setInrRate,
} from "../services/currency.service.js";
import { env } from "../lib/env.js";

export function createExchangeRateWorker(redis: Redis, prisma: PrismaClient) {
  const worker = new Worker(
    "exchange-rate-sync",
    async (_job: Job) => {
      const settings = await prisma.currencySettings.findUniqueOrThrow({
        where: { id: "singleton" },
      });

      if (!settings.autoUpdateEnabled) {
        console.log("[exchange-rate] Auto-update disabled, skipping");
        return;
      }

      const liveRate = await fetchLiveInrRate(env.EXCHANGE_RATE_API_URL);
      console.log(`[exchange-rate] Fetched live INR rate: ${liveRate}`);

      await setInrRate(
        redis,
        prisma,
        liveRate,
        Number(settings.markupPercent),
        true,
        settings.autoUpdateFreq as "hourly" | "daily",
        "auto",
      );

      console.log(
        `[exchange-rate] Rate updated: ${liveRate} INR/USD + ${settings.markupPercent}% markup`,
      );
    },
    { connection: redis, skipVersionCheck: true, concurrency: 1 },
  );

  return worker;
}

