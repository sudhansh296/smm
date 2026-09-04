import "./lib/env.js"; // Validate env first
import { PrismaClient } from "@nexussmm/db";
import { Redis } from "ioredis";
import { createQueues } from "@nexussmm/queue";
import { env } from "./lib/env.js";

import { createOrderForwardWorker } from "./workers/order-forward.worker.js";
import { createStatusPollWorker } from "./workers/status-poll.worker.js";
import { createRefillWorker } from "./workers/refill.worker.js";
import { createExchangeRateWorker } from "./workers/exchange-rate.worker.js";

async function startWorkers() {
  console.log("🔧 Starting NexusSMM Workers...");

  // Connect to services
  const prisma = new PrismaClient();
  await prisma.$connect();
  console.log("✅ PostgreSQL connected");

  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,
  });
  console.log("✅ Redis connected");

  const queues = createQueues(redis);

  // Start all workers
  const orderForwardWorker = createOrderForwardWorker(redis, prisma);
  const statusPollWorker = createStatusPollWorker(redis, prisma);
  const refillWorker = createRefillWorker(redis, prisma);
  const exchangeRateWorker = createExchangeRateWorker(redis, prisma);

  console.log("✅ All workers started");

  // Bug 4: Recovery — re-enqueue PENDING orders older than 5 min with no providerOrderId
  // This handles the case where Redis was down after DB commit (job was lost)
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
      for (const order of stuckOrders) {
        const existing = await queues.orderForward.getJob(order.id);
        if (!existing) {
          await queues.orderForward.add("forward", { orderId: order.id }, { jobId: order.id });
          console.log(`[worker-entrypoint] Recovered stuck PENDING order ${order.id}`);
        }
      }
      if (stuckOrders.length > 0) {
        console.log(`[worker-entrypoint] Recovery complete: checked ${stuckOrders.length} stuck orders`);
      }
    } catch (err) {
      console.error("[worker-entrypoint] Recovery scan failed:", err);
    }
  }

  // Run recovery after a short delay to let workers initialize
  setTimeout(() => { recoverPendingOrders().catch((e) => console.error("[worker-entrypoint] Recovery error:", e)); }, 5000);

  // Register repeatable status poll job — every 2 minutes
  await queues.statusPoll.add(
    "poll-all-open-orders",
    {},
    { repeat: { every: 120_000 } },
  );
  console.log("✅ Status poll job registered (every 2 min)");

  // Register exchange rate sync based on DB settings
  const currencySettings = await prisma.currencySettings.findUnique({
    where: { id: "singleton" },
  });

  if (currencySettings?.autoUpdateEnabled) {
    const cronExpression =
      currencySettings.autoUpdateFreq === "hourly" ? "0 * * * *" : "0 0 * * *";

    await queues.exchangeRateSync.add(
      "sync-rate",
      {},
      { repeat: { pattern: cronExpression } },
    );
    console.log(`✅ Exchange rate sync registered (${currencySettings.autoUpdateFreq})`);
  } else {
    console.log("ℹ️  Exchange rate auto-sync disabled");
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down workers...`);

    await Promise.all([
      orderForwardWorker.close(),
      statusPollWorker.close(),
      refillWorker.close(),
      exchangeRateWorker.close(),
    ]);

    await Promise.all([
      queues.orderForward.close(),
      queues.statusPoll.close(),
      queues.refill.close(),
      queues.exchangeRateSync.close(),
    ]);

    await prisma.$disconnect();
    await redis.quit();

    console.log("✅ Workers shut down cleanly");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Log worker errors
  [orderForwardWorker, statusPollWorker, refillWorker, exchangeRateWorker].forEach(
    (worker) => {
      worker.on("error", (err: Error) => {
        console.error(`[worker:${worker.name}] Error:`, err.message);
      });
    },
  );

  console.log("🚀 Workers running. Press Ctrl+C to stop.");
}

startWorkers().catch((err) => {
  console.error("❌ Worker startup failed:", err);
  process.exit(1);
});
