import { Decimal } from "decimal.js";
import type { PrismaClient } from "@nexussmm/db";
import { ProviderClient } from "./provider.service.js";
import { refundOrderTx } from "./wallet.service.js";
import { NotFoundError, ValidationError } from "../lib/errors.js";

/**
 * Shared cancellation service used by user route, API-v2, admin, and workers.
 * Single implementation prevents divergent behaviour across entry points.
 *
 * Returns the resulting order status and whether a refund was issued.
 */
export interface CancelResult {
  status: "CANCELLED" | "CANCEL_REQUESTED";
  refunded: boolean;
  message: string;
}

export async function cancelOrder(
  prisma: PrismaClient,
  orderId: string,
  requestingUserId: string, // pass admin userId for admin cancels, user's own id for user/v2
  isAdmin = false,
): Promise<CancelResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { service: { include: { provider: true } } },
  }) as any;

  if (!order) throw new NotFoundError("Order not found");

  // Ownership check — admin can cancel any order
  if (!isAdmin && order.userId !== requestingUserId) {
    throw new NotFoundError("Order not found");
  }

  const cancelableStatuses = ["PENDING", "FORWARDING", "PROCESSING", "IN_PROGRESS", "CANCEL_REQUESTED"];
  if (!cancelableStatuses.includes(order.status)) {
    throw new ValidationError(`Order cannot be cancelled (status: ${order.status})`);
  }

  // Already in cancel flow — idempotent
  if (order.status === "CANCEL_REQUESTED") {
    return { status: "CANCEL_REQUESTED", refunded: false, message: "Cancellation already in progress" };
  }

  // ── Fix 1: FORWARDING must NOT immediately refund ──────────────────────────
  // When FORWARDING, provider HTTP call may already be in flight.
  // Treat same as PROCESSING — set CANCEL_REQUESTED and attempt provider cancel.
  // Do NOT immediately refund — we don't know if provider has accepted.
  if (order.status === "FORWARDING") {
    // Mark CANCEL_REQUESTED atomically (conditional update guards against races)
    const marked = await prisma.order.updateMany({
      where: { id: orderId, status: "FORWARDING" } as never,
      data: { status: "CANCEL_REQUESTED" } as never,
    });

    if (marked.count === 0) {
      // Status changed between read and update — re-read and let caller retry
      const fresh = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } }) as any;
      throw new ValidationError(`Order status changed to ${fresh?.status ?? "unknown"} — please retry`);
    }

    // Try provider cancel best-effort (we may or may not have a providerOrderId yet)
    if (order.providerOrderId) {
      const result = await attemptProviderCancel(prisma, order);
      if (result === "cancelled") {
        await finaliseCancel(prisma, orderId, order);
        return { status: "CANCELLED", refunded: true, message: "Order cancelled and refunded" };
      }
    }

    // No providerOrderId yet or provider cancel failed — stay CANCEL_REQUESTED
    // The forward worker will see CANCEL_REQUESTED after provider responds
    return {
      status: "CANCEL_REQUESTED",
      refunded: false,
      message: "Cancellation requested. Refund will be issued once provider confirms.",
    };
  }

  // ── PENDING with no providerOrderId — safe immediate cancel + refund ───────
  if (order.status === "PENDING" && !order.providerOrderId) {
    await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status FROM orders WHERE id = ${orderId} FOR UPDATE
      `;
      if (!locked[0] || locked[0].status !== "PENDING") return;

      await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
      await refundOrderTx(tx as Parameters<typeof refundOrderTx>[0], orderId, {
        userId: order.userId,
        amountUsd: new Decimal(order.costUsd.toString()),
        inrRate: new Decimal(order.inrRateAtOrder.toString()),
        description: `Refund: order #${orderId.slice(-8)} cancelled (not forwarded to provider)`,
      });
      await tx.notification.create({
        data: {
          userId: order.userId,
          message: `Order #${orderId.slice(-8)} cancelled. $${new Decimal(order.costUsd.toString()).toFixed(2)} refunded.`,
        },
      });
    });
    return { status: "CANCELLED", refunded: true, message: "Order cancelled and refunded" };
  }

  // ── PROCESSING / IN_PROGRESS (or PENDING with providerOrderId) ──────────────
  // Provider has the order — must attempt cancellation before refunding

  if (!order.providerOrderId) {
    // Has PROCESSING status but no providerOrderId — unusual, safe to refund
    await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
      await refundOrderTx(tx as Parameters<typeof refundOrderTx>[0], orderId, {
        userId: order.userId,
        amountUsd: new Decimal(order.costUsd.toString()),
        inrRate: new Decimal(order.inrRateAtOrder.toString()),
        description: `Refund: order #${orderId.slice(-8)} cancelled`,
      });
      await tx.notification.create({
        data: {
          userId: order.userId,
          message: `Order #${orderId.slice(-8)} cancelled. $${new Decimal(order.costUsd.toString()).toFixed(2)} refunded.`,
        },
      });
    });
    return { status: "CANCELLED", refunded: true, message: "Order cancelled and refunded" };
  }

  // Mark CANCEL_REQUESTED atomically
  const marked = await prisma.order.updateMany({
    where: { id: orderId, status: order.status } as never,
    data: { status: "CANCEL_REQUESTED" } as never,
  });
  if (marked.count === 0) {
    const fresh = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } }) as any;
    throw new ValidationError(`Order status changed to ${fresh?.status ?? "unknown"} — please retry`);
  }

  // Fix 2: check provider cancel response — {error:...} does NOT throw
  const providerResult = await attemptProviderCancel(prisma, order);
  if (providerResult === "cancelled") {
    await finaliseCancel(prisma, orderId, order);
    return { status: "CANCELLED", refunded: true, message: "Order cancelled and refunded" };
  }

  // Provider cancel failed or returned error — stay CANCEL_REQUESTED
  // Status-poll worker will pick this up when provider eventually cancels
  return {
    status: "CANCEL_REQUESTED",
    refunded: false,
    message: "Cancellation requested. Refund will be issued once provider confirms.",
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function attemptProviderCancel(prisma: PrismaClient, order: any): Promise<"cancelled" | "failed"> {
  if (!order.providerOrderId) return "failed";

  const providerId = order.fulfillmentProviderId ?? order.service.providerId;
  let provider = order.service.provider;

  if (providerId !== order.service.providerId) {
    const alt = await prisma.provider.findUnique({ where: { id: providerId } });
    if (alt) provider = alt;
  }

  try {
    const client = new ProviderClient(provider);
    const result = await client.cancelOrder(order.providerOrderId);

    // Fix 2: check for {error:...} — does NOT throw, must be explicitly checked
    if ("error" in result) {
      console.warn(`[cancel-service] Provider cancel returned error for order ${order.id}: ${result.error}`);
      return "failed";
    }

    // Standard SMM API returns { cancel: 1 } on success
    if ("cancel" in result && result.cancel === 1) {
      return "cancelled";
    }

    // Unknown response shape — treat as failure to be safe
    console.warn(`[cancel-service] Unexpected provider cancel response for order ${order.id}:`, result);
    return "failed";
  } catch (err) {
    console.warn(`[cancel-service] Provider cancel threw for order ${order.id}:`, err);
    return "failed";
  }
}

async function finaliseCancel(prisma: PrismaClient, orderId: string, order: any): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
    await refundOrderTx(tx as Parameters<typeof refundOrderTx>[0], orderId, {
      userId: order.userId,
      amountUsd: new Decimal(order.costUsd.toString()),
      inrRate: new Decimal(order.inrRateAtOrder.toString()),
      description: `Refund: order #${orderId.slice(-8)} cancelled (provider confirmed)`,
    });
    await tx.notification.create({
      data: {
        userId: order.userId,
        message: `Order #${orderId.slice(-8)} cancelled. $${new Decimal(order.costUsd.toString()).toFixed(2)} refunded.`,
      },
    });
  });
}