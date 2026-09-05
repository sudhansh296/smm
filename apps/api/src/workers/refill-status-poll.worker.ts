import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import type { PrismaClient } from "@nexussmm/db";
import { ProviderClient } from "../services/provider.service.js";

// Maps provider refill status strings to our internal values
const REFILL_STATUS_MAP: Record<string, string> = {
  Pending:      "pending",
  Processing:   "processing",
  Completed:    "completed",
  Complete:     "completed",
  Error:        "failed",
  Rejected:     "failed",
  Canceled:     "failed",
  Cancelled:    "failed",
};

export function createRefillStatusPollWorker(redis: Redis, prisma: PrismaClient) {
  const worker = new Worker(
    "refill-status-poll",
    async (_job: Job) => {
      // Find all orders with a providerRefillId still in processing state
      const processingOrders = await prisma.order.findMany({
        where: {
          refillStatus: "processing",
          providerRefillId: { not: null },
        },
        include: { service: { include: { provider: true } } },
      }) as any[];

      if (!processingOrders.length) return;

      for (const order of processingOrders) {
        try {
          const fulfillmentProviderId = order.fulfillmentProviderId ?? order.service.providerId;
          let provider = order.service.provider;
          if (fulfillmentProviderId !== order.service.providerId) {
            const alt = await prisma.provider.findUnique({ where: { id: fulfillmentProviderId } });
            if (alt) provider = alt;
          }

          const client = new ProviderClient(provider);
          const result = await client.getRefillStatus(order.providerRefillId);

          if ("error" in result) {
            console.warn(`[refill-status-poll] Order ${order.id}: provider error ${result.error}`);
            await prisma.order.update({ where: { id: order.id }, data: { refillStatus: "failed" } });
            continue;
          }

          const providerStatus = (result as any).status ?? "";
          const mapped = REFILL_STATUS_MAP[providerStatus] ?? null;

          if (!mapped) {
            console.warn(`[refill-status-poll] Order ${order.id}: unknown refill status "${providerStatus}"`);
            continue; // leave as "processing", try again next poll
          }

          if (mapped !== order.refillStatus) {
            await prisma.order.update({ where: { id: order.id }, data: { refillStatus: mapped } });
            console.log(`[refill-status-poll] Order ${order.id}: refillStatus ${order.refillStatus} → ${mapped}`);

            if (mapped === "completed") {
              await (prisma as any).notification.create({
                data: { userId: order.userId, message: `Refill for order #${order.id.slice(-8)} completed.` },
              });
            } else if (mapped === "failed") {
              await (prisma as any).notification.create({
                data: { userId: order.userId, message: `Refill for order #${order.id.slice(-8)} failed. You can request a new refill.` },
              });
            }
          }
        } catch (err) {
          console.error(`[refill-status-poll] Error polling refill for order ${order.id}:`, err);
        }
      }

      console.log(`[refill-status-poll] Polled ${processingOrders.length} processing refills`);
    },
    { connection: redis, skipVersionCheck: true, concurrency: 1 },
  );

  return worker;
}
