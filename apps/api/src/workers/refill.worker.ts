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
        throw new Error("No provider order ID — cannot request refill");
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
        // Do NOT throw after marking failed — job is done (failed gracefully)
        console.warn(`[refill] Order ${orderId} refill rejected by provider: ${result.error}`);
        return;
      }

      await prisma.order.update({
        where: { id: orderId },
        data: { providerRefillId: result.refill.toString(), refillStatus: "processing" },
      });

      console.log(`[refill] Order ${orderId} refill submitted → refill ID ${result.refill}`);
    },
    { connection: redis, skipVersionCheck: true, concurrency: 3 },
  );

  return worker;
}