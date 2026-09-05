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
  console.log("ðŸ”§ Starting NexusSMM Workers...");

  // Connect to services
  const prisma = new PrismaClient();
  await prisma.$connect();
  console.log("âœ… PostgreSQL connected");

  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,
  });
  console.log("âœ… Redis connected");

  const queues = createQueues(redis);

  // Start all workers
  const orderForwardWorker = createOrderForwardWorker(redis, prisma);
  const statusPollWorker = createStatusPollWorker(redis, prisma);
  const refillWorker = createRefillWorker(redis, prisma);
  const exchangeRateWorker = createExchangeRateWorker(redis, prisma);

  console.log("âœ… All workers started");

  // Bug 4: Recovery â€” re-enqueue PENDING orders older than 5 min with no providerOrderId
  // This handles the case where Redis was down after DB commit (job was lost)
  async function recoverPendingOrders() {
    try {
      // Issue 4 fix: recover orders that are PENDING with no providerOrderId
      // (wallet charged + order created but forwarding job was lost)
      // Orders with providerOrderId are already being delivered — do not re-enqueue.
      const stuckOrders = await prisma.order.findMany({
        where: {
          status: "PENDING",
          providerOrderId: null,
          createdAt: { lt: new Date(Date.now() - 5 * 60 * 1000) }, // older than 5 min
        },
        select: { id: true },
      });

      let recovered = 0;
      for (const order of stuckOrders) {
        // Check if a job already exists in the queue for this order
        const existingJob = await queues.orderForward.getJob(order.id);
        if (!existingJob) {
          await queues.orderForward.add(
            "forward",
            { orderId: order.id },
            {
              jobId: order.id,     // deterministic — prevents duplicate queue entries
              attempts: 3,
              backoff: { type: "exponential", delay: 5000 },
            },
          );
          console.log(`[worker-entrypoint] Recovered stuck PENDING order ${order.id}`);
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

  // Run recovery after a short delay to let workers initialize
  setTimeout(() => { recoverPendingOrders().catch((e) => console.error("[worker-entrypoint] Recovery error:", e)); }, 5000);

  // Register repeatable status poll job â€” every 2 minutes
  await queues.statusPoll.add(
    "poll-all-open-orders",
    {},
    { repeat: { every: 120_000 } },
  );
  console.log("âœ… Status poll job registered (every 2 min)");

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
    console.log(`âœ… Exchange rate sync registered (${currencySettings.autoUpdateFreq})`);
  } else {
    console.log("â„¹ï¸  Exchange rate auto-sync disabled");
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

    console.log("âœ… Workers shut down cleanly");
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

  console.log("ðŸš€ Workers running. Press Ctrl+C to stop.");
}

startWorkers().catch((err) => {
  console.error("âŒ Worker startup failed:", err);
  process.exit(1);
});
