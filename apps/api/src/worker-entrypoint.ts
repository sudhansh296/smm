import "./lib/env.js";
import { PrismaClient } from "@nexussmm/db";
import { Redis } from "ioredis";
import { createQueues } from "@nexussmm/queue";
import { env } from "./lib/env.js";

import { createOrderForwardWorker } from "./workers/order-forward.worker.js";
import { createStatusPollWorker } from "./workers/status-poll.worker.js";
import { createRefillWorker } from "./workers/refill.worker.js";
import { createExchangeRateWorker } from "./workers/exchange-rate.worker.js";
import { createRefillStatusPollWorker } from "./workers/refill-status-poll.worker.js";
import { createOrderCancelWorker } from "./workers/order-cancel.worker.js";

async function startWorkers() {
  console.log("[workers] Starting NexusSMM Workers...");

  const prisma = new PrismaClient();
  await prisma.$connect();
  console.log("[workers] PostgreSQL connected");

  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  console.log("[workers] Redis connected");

  const queues = createQueues(redis);

  const orderForwardWorker  = createOrderForwardWorker(redis, prisma);
  const statusPollWorker    = createStatusPollWorker(redis, prisma);
  const refillWorker        = createRefillWorker(redis, prisma);
  const exchangeRateWorker       = createExchangeRateWorker(redis, prisma);
  const refillStatusPollWorker   = createRefillStatusPollWorker(redis, prisma);
  const orderCancelWorker        = createOrderCancelWorker(redis, prisma);

  console.log("[workers] All workers started");

  async function recoverPendingOrders() {
    try {
      const stuckOrders = await prisma.order.findMany({
        where: {
          status: "PENDING",
          providerOrderId: null,
          createdAt: { lt: new Date(Date.now() - 5 * 60 * 1000) },
        },
        select: { id: true },
      });

      let recovered = 0;
      for (const order of stuckOrders) {
        const existingJob = await queues.orderForward.getJob(order.id);
        // Fix: check job state  --  completed/failed jobs are stale and must be re-enqueued
        const jobState = existingJob ? await existingJob.getState() : null;
        const shouldRequeue = !existingJob || ["completed", "failed", "unknown"].includes(jobState ?? "");
        if (shouldRequeue) {
          if (existingJob) { try { await existingJob.remove(); } catch { /* ignore */ } }
          await queues.orderForward.add(
            "forward",
            { orderId: order.id },
            { jobId: order.id, attempts: 3, backoff: { type: "exponential", delay: 5000 } },
          );
          // Fix 1: proper template literal  --  was broken (invalid TS syntax)
          console.log(`[worker-entrypoint] Recovered stuck PENDING order ${order.id} (prev state: ${jobState ?? "none"})`);
          recovered++;
        }
      }

      if (stuckOrders.length > 0) {
        console.log(`[worker-entrypoint] Recovery: found ${stuckOrders.length} stuck, re-enqueued ${recovered}`);
      }
    } catch (err) {
      console.error("[worker-entrypoint] Recovery scan failed:", err);
    }
  }

  // Run at startup after 5s, then every 2 minutes
  setTimeout(() => {
    recoverPendingOrders().catch((e) => console.error("[worker-entrypoint] Startup recovery error:", e));
    setInterval(() => {
      recoverPendingOrders().catch((e) => console.error("[worker-entrypoint] Periodic recovery error:", e));
    }, 2 * 60 * 1000);
  }, 5000);

  await queues.statusPoll.add("poll-all-open-orders", {}, { repeat: { every: 120_000 } });
  console.log("[workers] Status poll job registered (every 2 min)");

  // Refill status polling  --  checks provider for orders in "processing" refill state
  const refillStatusQueue = new (await import("bullmq")).Queue("refill-status-poll", {
    connection: redis, skipVersionCheck: true,
  });
  await refillStatusQueue.add("poll-processing-refills", {}, { repeat: { every: 3 * 60 * 1000 } });
  console.log("[workers] Refill status poll registered (every 3 min)");

  const currencySettings = await prisma.currencySettings.findUnique({ where: { id: "singleton" } });
  if (currencySettings?.autoUpdateEnabled) {
    const cron = currencySettings.autoUpdateFreq === "hourly" ? "0 * * * *" : "0 0 * * *";
    await queues.exchangeRateSync.add("sync-rate", {}, { repeat: { pattern: cron } });
    console.log(`[workers] Exchange rate sync registered (${currencySettings.autoUpdateFreq})`);
  } else {
    console.log("[workers] Exchange rate auto-sync disabled");
  }

  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down workers...`);
    await Promise.all([
      orderForwardWorker.close(), statusPollWorker.close(),
      refillWorker.close(), exchangeRateWorker.close(), refillStatusPollWorker.close(), orderCancelWorker.close(),
    ]);
    await Promise.all([
      queues.orderForward.close(), queues.statusPoll.close(),
      queues.refill.close(), queues.exchangeRateSync.close(),
    ]);
    await prisma.$disconnect();
    await redis.quit();
    console.log("[workers] Workers shut down cleanly");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));

  [orderForwardWorker, statusPollWorker, refillWorker, exchangeRateWorker, refillStatusPollWorker, orderCancelWorker].forEach((w) => {
    w.on("error", (err: Error) => console.error(`[worker:${w.name}] Error:`, err.message));
  });

  console.log("[workers] Workers running. Press Ctrl+C to stop.");
}

startWorkers().catch((err) => {
  console.error("[workers] Worker startup failed:", err);
  process.exit(1);
});
