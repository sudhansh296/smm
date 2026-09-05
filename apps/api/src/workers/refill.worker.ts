import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import type { PrismaClient } from "@nexussmm/db";
import type { RefillJobData } from "@nexussmm/types";
import { ProviderClient } from "../services/provider.service.js";

export function createRefillWorker(redis: Redis, prisma: PrismaClient) {
  const worker = new Worker<RefillJobData>(
    "refill",
    async (job: Job<RefillJobData>) => {
      const { orderId } = job.data;

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { service: { include: { provider: true } } },
      }) as any;

      if (!order) {
        console.warn(`[refill] Order ${orderId} not found`);
        return;
      }

      if (!order.providerOrderId) {
        // Clear pending status so user can try again
        await prisma.order.update({ where: { id: orderId }, data: { refillStatus: "failed" } });
        throw new Error("No provider order ID â€” cannot request refill");
      }

      const fulfillmentProviderId = order.fulfillmentProviderId ?? order.service.providerId;
      let provider = order.service.provider;

      if (fulfillmentProviderId !== order.service.providerId) {
        const altProvider = await prisma.provider.findUnique({ where: { id: fulfillmentProviderId } });
        if (altProvider) provider = altProvider;
        else console.warn(`[refill] Fulfillment provider ${fulfillmentProviderId} not found, using service provider`);
      }

      const client = new ProviderClient(provider);
      const result = await client.requestRefill(order.providerOrderId);

      if ("error" in result) {
        // Issue 5 fix: set refillStatus to "failed" (not "pending" or "processing")
        // so the user/API can request another refill after this one fails.
        await prisma.order.update({
          where: { id: orderId },
          data: { refillStatus: "failed" },
        });
        await prisma.notification.create({
          data: { userId: order.userId, message: `Refill failed for order #${orderId}: ${result.error}` },
        });
        // Do NOT throw after marking failed â€” job is done (failed gracefully)
        console.warn(`[refill] Order ${orderId} refill rejected by provider: ${result.error}`);
        return;
      }

      await prisma.order.update({
        where: { id: orderId },
        data: { providerRefillId: result.refill.toString(), refillStatus: "processing" },
      });

      console.log(`[refill] Order ${orderId} refill submitted â†’ refill ID ${result.refill}`);
    },
    { connection: redis, skipVersionCheck: true, concurrency: 3 },
  );

  // Fix 5: on final retry exhaustion (network errors, timeouts etc.)
  // set refillStatus="failed" so the order unlocks for another refill attempt
  worker.on("failed", async (
    job: { data: { orderId: string }; opts: { attempts?: number }; attemptsMade: number } | undefined,
    _err: Error,
  ) => {
    if (!job || (job.opts.attempts && job.attemptsMade < job.opts.attempts)) return;

    try {
      await prisma.order.updateMany({
        where: { id: job.data.orderId, refillStatus: { in: ["pending", "processing"] } },
        data: { refillStatus: "failed" },
      });
      console.warn(`[refill] Order ${job.data.orderId}: set refillStatus=failed after exhausted retries`);
    } catch (err) {
      console.error(`[refill] Failed to update refillStatus for ${job.data.orderId}:`, err);
    }
  });

  return worker;
}