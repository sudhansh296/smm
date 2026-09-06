import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import type { PrismaClient } from "@nexussmm/db";
import { ProviderClient } from "../services/provider.service.js";
import { Decimal } from "decimal.js";

export function createOrderCancelWorker(redis: Redis, prisma: PrismaClient) {
  const worker = new Worker<{ orderId: string }>(
    "order-cancel",
    async (job: Job<{ orderId: string }>) => {
      const { orderId } = job.data;

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { service: { include: { provider: true } } },
      }) as any;

      if (!order) {
        console.warn(`[order-cancel] Order ${orderId} not found -- skipping`);
        return;
      }

      if (order.status !== "CANCEL_REQUESTED") {
        console.log(`[order-cancel] Order ${orderId} is now ${order.status} -- no retry needed`);
        return;
      }

      // Fix 1: providerOrderId null = provider call may still be in-flight (FORWARDING race).
      // NEVER refund here — cancelOrder() already handles the true no-provider case.
      // Throw so BullMQ retries with backoff until providerOrderId appears or status changes.
      if (!order.providerOrderId) {
        // Re-read with row lock to get latest state
        const latest = await prisma.$queryRaw<Array<{ status: string; providerOrderId: string | null }>>`
          SELECT status, "providerOrderId" FROM orders WHERE id = ${orderId} FOR UPDATE
        `;
        if (!latest[0]) return;
        if (latest[0].status !== "CANCEL_REQUESTED") {
          console.log(`[order-cancel] Order ${orderId} status changed to ${latest[0].status} -- done`);
          return;
        }
        if (!latest[0].providerOrderId) {
          // Still no providerOrderId -- provider call may be in-flight, retry later
          throw new Error(`[order-cancel] Order ${orderId}: providerOrderId not yet available -- retry`);
        }
        // providerOrderId appeared between reads -- fall through to cancel below
        order.providerOrderId = latest[0].providerOrderId;
      }

      // Re-send cancel to provider
      const fulfillmentProviderId = order.fulfillmentProviderId ?? order.service.providerId;
      let provider = order.service.provider;
      if (fulfillmentProviderId !== order.service.providerId) {
        const alt = await prisma.provider.findUnique({ where: { id: fulfillmentProviderId } });
        if (alt) provider = alt;
      }

      const client = new ProviderClient(provider);
      const result = await client.cancelOrder(order.providerOrderId);

      if ("cancel" in result && result.cancel === 1) {
        // cancel:1 = accepted, not confirmed. Status-poll will finalize.
        console.log(`[order-cancel] Order ${orderId}: cancel accepted (cancel:1) -- status-poll will confirm`);
        return;
      } else if ("error" in result) {
        throw new Error(`Provider cancel rejected: ${result.error}`);
      }

      throw new Error(`Unexpected provider cancel response: ${JSON.stringify(result)}`);
    },
    { connection: redis, skipVersionCheck: true, concurrency: 3 },
  );

  return worker;
}