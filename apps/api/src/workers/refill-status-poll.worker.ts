import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import type { PrismaClient } from "@nexussmm/db";
import { ProviderClient } from "../services/provider.service.js";

// Standard SMM API refill status -> our internal refillStatus
const REFILL_STATUS_MAP: Record<string, string> = {
  Pending:    "pending",
  Processing: "processing",
  Completed:  "completed",
  Complete:   "completed",
  Error:      "failed",
  Rejected:   "failed",
  Canceled:   "failed",
  Cancelled:  "failed",
};

// Refill statuses that are still active and need polling
const ACTIVE_REFILL_STATUSES = ["pending", "processing"];

export function createRefillStatusPollWorker(redis: Redis, prisma: PrismaClient) {
  const worker = new Worker(
    "refill-status-poll",
    async (_job: Job) => {
      // Fix 1: query BOTH "pending" and "processing"  --  provider may return "Pending"
      // which we map back to "pending", so that order must remain pollable
      const activeOrders = await prisma.order.findMany({
        where: {
          refillStatus: { in: ACTIVE_REFILL_STATUSES },
          providerRefillId: { not: null },
        },
        include: { service: { include: { provider: true } } },
      }) as any[];

      if (!activeOrders.length) return;

      for (const order of activeOrders) {
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
            await (prisma as any).notification.create({
              data: { userId: order.userId, message: `Refill for order #${order.id.slice(-8)} failed.` },
            });
            continue;
          }

          const providerStatus = (result as any).status ?? "";
          const mapped = REFILL_STATUS_MAP[providerStatus] ?? null;

          if (!mapped) {
            // Unknown status  --  keep polling, do not change
            console.warn(`[refill-status-poll] Order ${order.id}: unknown status "${providerStatus}"  --  will retry`);
            continue;
          }

          // Fix 1: only write if status actually changed  --  prevents noisy updates
          if (mapped === order.refillStatus) continue;

          await prisma.order.update({ where: { id: order.id }, data: { refillStatus: mapped } });
          console.log(`[refill-status-poll] Order ${order.id}: ${order.refillStatus} -> ${mapped}`);

          if (mapped === "completed") {
            await (prisma as any).notification.create({
              data: { userId: order.userId, message: `Refill for order #${order.id.slice(-8)} completed successfully.` },
            });
          } else if (mapped === "failed") {
            await (prisma as any).notification.create({
              data: { userId: order.userId, message: `Refill for order #${order.id.slice(-8)} failed. You can request a new refill.` },
            });
          }
          // "pending" or "processing"  --  no notification needed, keep polling
        } catch (err) {
          console.error(`[refill-status-poll] Error polling order ${order.id}:`, err);
        }
      }

      if (activeOrders.length) {
        console.log(`[refill-status-poll] Polled ${activeOrders.length} active refills`);
      }
    },
    { connection: redis, skipVersionCheck: true, concurrency: 1 },
  );

  return worker;
}