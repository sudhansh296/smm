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
      });

      if (!order) {
        console.warn(`[refill] Order ${orderId} not found`);
        return;
      }

      if (!order.providerOrderId) {
        throw new Error("No provider order ID — cannot request refill");
      }

      const client = new ProviderClient(order.service.provider);
      const result = await client.requestRefill(order.providerOrderId);

      if ("error" in result) {
        // Mark refill failed and notify user
        await prisma.order.update({
          where: { id: orderId },
          data: { refillStatus: "failed" },
        });

        await prisma.notification.create({
          data: {
            userId: order.userId,
            message: `Refill failed for order #${orderId}: ${result.error}`,
          },
        });

        throw new Error(`Refill rejected by provider: ${result.error}`);
      }

      await prisma.order.update({
        where: { id: orderId },
        data: {
          providerRefillId: result.refill.toString(),
          refillStatus: "processing",
        },
      });

      console.log(
        `[refill] Order ${orderId} refill submitted → provider refill ID ${result.refill}`,
      );
    },
    { connection: redis, skipVersionCheck: true, concurrency: 3 },
  );

  return worker;
}

