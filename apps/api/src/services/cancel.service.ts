import { Decimal } from "decimal.js";
import type { PrismaClient } from "@nexussmm/db";
import { ProviderClient } from "./provider.service.js";
import { refundOrderTx } from "./wallet.service.js";
import { NotFoundError, ValidationError, AlreadyRefundedError } from "../lib/errors.js";

export interface CancelResult {
  status: "CANCELLED" | "CANCEL_REQUESTED";
  refunded: boolean;
  message: string;
}

// Fix #2: always use the actual fulfillment provider for cancel/status calls
async function loadFulfillmentProvider(prisma: PrismaClient, order: any) {
  const fulfillmentProviderId = order.fulfillmentProviderId ?? order.service.providerId;
  if (fulfillmentProviderId === order.service.providerId) return order.service.provider;
  const alt = await prisma.provider.findUnique({ where: { id: fulfillmentProviderId } });
  return alt ?? order.service.provider;
}

// Fix #3: clear semantics  --  remains=0 means fully delivered, no refund
function calcCancelRefund(costUsd: string, quantity: number, remains: number | undefined): Decimal {
  const total = new Decimal(costUsd);
  if (remains === undefined || remains >= quantity) return total;        // unknown or nothing delivered
  if (remains === 0)                                return new Decimal(0); // fully delivered
  return total.times(new Decimal(remains).dividedBy(quantity)).toDecimalPlaces(8);
}

// Enqueue a cancel retry job  --  called when provider cancel fails on first attempt
export async function enqueueOrderCancelRetry(
  queues: { orderCancel: { add: Function } },
  orderId: string,
): Promise<void> {
  try {
    await queues.orderCancel.add(
      "retry-cancel",
      { orderId },
      {
        jobId: `cancel:${orderId}`,  // deterministic  --  one retry job per order
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
    console.log(`[cancel-service] Enqueued retry cancel job for order ${orderId}`);
  } catch (err) {
    console.error(`[cancel-service] Failed to enqueue cancel retry for ${orderId}:`, err);
  }
}

export async function cancelOrder(
  prisma: PrismaClient,
  orderId: string,
  requestingUserId: string,
  isAdmin = false,
): Promise<CancelResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { service: { include: { provider: true } } },
  }) as any;

  if (!order) throw new NotFoundError("Order not found");
  if (!isAdmin && order.userId !== requestingUserId) throw new NotFoundError("Order not found");

  const cancelableStatuses = ["PENDING", "FORWARDING", "PROCESSING", "IN_PROGRESS", "CANCEL_REQUESTED"];
  if (!cancelableStatuses.includes(order.status)) {
    throw new ValidationError(`Order cannot be cancelled (status: ${order.status})`);
  }
  if (order.status === "CANCEL_REQUESTED") {
    return { status: "CANCEL_REQUESTED", refunded: false, message: "Cancellation already in progress" };
  }

  // FORWARDING  --  provider call in flight, do not refund immediately
  if (order.status === "FORWARDING") {
    const marked = await prisma.order.updateMany({
      where: { id: orderId, status: "FORWARDING" } as never,
      data: { status: "CANCEL_REQUESTED" } as never,
    });
    if (marked.count === 0) {
      const fresh = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } }) as any;
      throw new ValidationError(`Order status changed to ${fresh?.status ?? "unknown"}  --  please retry`);
    }
    if (order.providerOrderId) {
      const fwdProvider = await loadFulfillmentProvider(prisma, order);
      const cancelResult = await attemptProviderCancel(fwdProvider, order.providerOrderId);
      if (cancelResult === "cancelled") {
        // Fix 9: need confirmed remains before refunding  --  same as PROCESSING path
        let fwdRemains: number | undefined;
        let fwdFetchOk = false;
        try {
          const fwdClient = new ProviderClient(fwdProvider);
          const fwdStatus = await fwdClient.getStatus(order.providerOrderId);
          if (!("error" in fwdStatus) && fwdStatus.status !== undefined && fwdStatus.remains !== undefined) {
            const parsed = Number(fwdStatus.remains);
            if (
              !isNaN(parsed) &&
              Number.isInteger(parsed) &&
              parsed >= 0 &&
              parsed <= order.quantity
            ) { fwdRemains = parsed; fwdFetchOk = true; }
          }
        } catch { /* network error  --  stay CANCEL_REQUESTED */ }
        if (!fwdFetchOk) {
          return { status: "CANCEL_REQUESTED", refunded: false, message: "Cancellation accepted. Refund calculated once delivery status confirmed." };
        }
        await finaliseCancel(prisma, orderId, order, fwdRemains);
        return { status: "CANCELLED", refunded: true, message: "Order cancelled and refunded" };
      }
    }
    return { status: "CANCEL_REQUESTED", refunded: false, message: "Cancellation requested. Refund will be issued once provider confirms." };
  }

  // PENDING with no providerOrderId  --  nothing sent to provider
  if (order.status === "PENDING" && !order.providerOrderId) {
    // Fix 7: transaction returns boolean so we know if cancel actually happened
    // Race: worker may have changed status to FORWARDING between our read and the lock
    const didCancel = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM orders WHERE id = ${orderId} FOR UPDATE`;
      if (!locked[0] || locked[0].status !== "PENDING") return false; // status changed  --  don't cancel
      await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
      await refundOrderTx(tx as Parameters<typeof refundOrderTx>[0], orderId, {
        userId: order.userId,
        amountUsd: new Decimal(order.costUsd.toString()),
        inrRate: new Decimal(order.inrRateAtOrder.toString()),
        description: `Refund: order #${orderId.slice(-8)} cancelled (not forwarded to provider)`,
      });
      await tx.notification.create({ data: { userId: order.userId, message: `Order #${orderId.slice(-8)} cancelled. $${new Decimal(order.costUsd.toString()).toFixed(2)} refunded.` } });
      return true;
    });

    if (didCancel) {
      return { status: "CANCELLED", refunded: true, message: "Order cancelled and refunded" };
    }

    // Status changed between read and lock (e.g. FORWARDING)  --  re-read and handle
    const fresh = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true, providerOrderId: true } }) as any;
    if (!fresh) throw new NotFoundError("Order not found");
    // Recursive call with fresh state  --  one level deep only (status is now FORWARDING/PROCESSING)
    if (["FORWARDING", "PROCESSING", "IN_PROGRESS"].includes(fresh.status)) {
      return cancelOrder(prisma, orderId, requestingUserId, isAdmin);
    }
    return { status: "CANCEL_REQUESTED", refunded: false, message: `Order in ${fresh.status}  --  cancellation requested` };
  }

  // PROCESSING/IN_PROGRESS without providerOrderId  --  unusual state, safe to cancel
  if (!order.providerOrderId) {
    // Fix 4: row lock + re-read before acting  --  another worker may have set providerOrderId
    const didCancel = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string; providerOrderId: string | null }>>`
        SELECT status, "providerOrderId" FROM orders WHERE id = ${orderId} FOR UPDATE
      `;
      // If providerOrderId appeared or status changed, abort  --  let caller handle
      if (!locked[0] || locked[0].providerOrderId || !["PROCESSING","IN_PROGRESS"].includes(locked[0].status)) {
        return false;
      }
      await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
      await refundOrderTx(tx as Parameters<typeof refundOrderTx>[0], orderId, {
        userId: order.userId,
        amountUsd: new Decimal(order.costUsd.toString()),
        inrRate: new Decimal(order.inrRateAtOrder.toString()),
        description: `Refund: order #${orderId.slice(-8)} cancelled`,
      });
      await tx.notification.create({ data: { userId: order.userId, message: `Order #${orderId.slice(-8)} cancelled. $${new Decimal(order.costUsd.toString()).toFixed(2)} refunded.` } });
      return true;
    });
    if (didCancel) return { status: "CANCELLED", refunded: true, message: "Order cancelled and refunded" };
    // providerOrderId appeared or status changed  --  fall through to normal cancel flow
    return cancelOrder(prisma, orderId, requestingUserId, isAdmin);
  }

  // Fix #5: if service doesn't support cancel, reject when provider has the order
  if (!order.service.supportsCancel) {
    throw new ValidationError("This service does not support cancellation. The order will continue processing.");
  }

  // Mark CANCEL_REQUESTED atomically
  const marked = await prisma.order.updateMany({
    where: { id: orderId, status: order.status } as never,
    data: { status: "CANCEL_REQUESTED" } as never,
  });
  if (marked.count === 0) {
    const fresh = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } }) as any;
    throw new ValidationError(`Order status changed to ${fresh?.status ?? "unknown"}  --  please retry`);
  }

  // Fix #2: use actual fulfillment provider for cancel
  const provider = await loadFulfillmentProvider(prisma, order);
  const providerResult = await attemptProviderCancel(provider, order.providerOrderId);

  if (providerResult === "cancelled") {
    // Fix #2: fetch fresh remains from fulfillment provider before refunding
    // If status fetch fails (network error), remains is unknown.
    // Unknown remains = we don't know how much was delivered = do NOT immediately refund.
    // Stay CANCEL_REQUESTED and let status-poll finalize with confirmed data.
    let freshRemains: number | undefined;
    let statusFetchSuccess = false;
    try {
      const client = new ProviderClient(provider);
      const freshStatus = await client.getStatus(order.providerOrderId);
      // Fix: treat {error:...} response as unknown  --  do NOT use as confirmed data
      if ("error" in freshStatus || freshStatus.status === undefined) {
        console.warn(`[cancel-service] Fresh status returned error/invalid for ${orderId}:`, freshStatus);
        // statusFetchSuccess stays false  --  will stay CANCEL_REQUESTED
      } else if (freshStatus.remains === undefined || freshStatus.remains === null) {
        // Fix 8: status OK but remains missing  --  still unknown, do not finalize refund
        console.warn(`[cancel-service] Fresh status has no remains for ${orderId}  --  staying CANCEL_REQUESTED`);
      } else {
        const parsed = Number(freshStatus.remains);
        if (
          isNaN(parsed) ||
          !Number.isInteger(parsed) ||
          parsed < 0 ||
          parsed > order.quantity
        ) {
          console.warn(`[cancel-service] Fresh status invalid remains (${parsed}) for ${orderId}  --  staying CANCEL_REQUESTED`);
        } else {
          freshRemains = parsed;
          statusFetchSuccess = true;
        }
      }
    } catch (err) {
      console.warn(`[cancel-service] Fresh status fetch failed for ${orderId}:`, err);
    }

    if (!statusFetchSuccess) {
      // Cannot determine how much was delivered  --  stay CANCEL_REQUESTED
      // Status-poll will finalize with confirmed data when network recovers
      console.warn(`[cancel-service] Order ${orderId}: cancel confirmed but status unknown  --  staying CANCEL_REQUESTED for safe poll`);
      return {
        status: "CANCEL_REQUESTED",
        refunded: false,
        message: "Cancellation accepted by provider. Refund will be calculated once delivery status is confirmed.",
      };
    }

    await finaliseCancel(prisma, orderId, order, freshRemains);
    return { status: "CANCELLED", refunded: true, message: "Order cancelled and refunded" };
  }

  return { status: "CANCEL_REQUESTED", refunded: false, message: "Cancellation requested. Refund will be issued once provider confirms." };
}

async function attemptProviderCancel(provider: any, providerOrderId: string): Promise<"cancelled" | "failed"> {
  try {
    const client = new ProviderClient(provider);
    const result = await client.cancelOrder(providerOrderId);
    if ("error" in result) {
      console.warn(`[cancel-service] Provider cancel error: ${result.error}`);
      return "failed";
    }
    if ("cancel" in result && result.cancel === 1) return "cancelled";
    console.warn("[cancel-service] Unexpected provider cancel response:", result);
    return "failed";
  } catch (err) {
    console.warn("[cancel-service] Provider cancel threw:", err);
    return "failed";
  }
}

async function finaliseCancel(
  prisma: PrismaClient,
  orderId: string,
  order: any,
  remains: number | undefined,
): Promise<void> {
  const refundAmount = calcCancelRefund(order.costUsd.toString(), order.quantity, remains);

  await prisma.$transaction(async (tx) => {
    // Fix 4: verify order is still in a cancellable state before overwriting
    const current = await tx.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM orders WHERE id = ${orderId} FOR UPDATE
    `;
    // Fix 2: block if order reached any terminal or financial state mid-race
    const safeToCancel = ["PENDING","FORWARDING","PROCESSING","IN_PROGRESS","CANCEL_REQUESTED"];
    if (!current[0] || !safeToCancel.includes(current[0].status)) {
      // Order moved to COMPLETED/PARTIAL/REFUNDED/CANCELLED  --  do not overwrite
      return;
    }
    await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
    if (refundAmount.greaterThan(0)) {
      // Fix #1: only catch AlreadyRefundedError  --  real errors propagate and rollback transaction
      try {
        await refundOrderTx(tx as Parameters<typeof refundOrderTx>[0], orderId, {
          userId: order.userId,
          amountUsd: refundAmount,
          inrRate: new Decimal(order.inrRateAtOrder.toString()),
          description: `Refund: order #${orderId.slice(-8)} cancelled (provider confirmed)`,
        });
      } catch (err) {
        if (err instanceof AlreadyRefundedError) {
          console.log(`[cancel-service] Order ${orderId} already refunded  --  skipping`);
        } else {
          throw err; // DB error, Prisma error, etc.  --  rollback
        }
      }
    }
    await tx.notification.create({
      data: {
        userId: order.userId,
        message: `Order #${orderId.slice(-8)} cancelled. ${refundAmount.greaterThan(0) ? `$${refundAmount.toFixed(2)} refunded.` : "No refund (fully delivered before cancel)."}`,
      },
    });
  });
}