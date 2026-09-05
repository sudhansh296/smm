import { Decimal } from "decimal.js";
import type { PrismaClient, TransactionType } from "@nexussmm/db";
import type { Queues } from "@nexussmm/queue";
import { getEffectiveInrRate } from "./currency.service.js";
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  InsufficientBalanceError,
} from "../lib/errors.js";
import type { Redis } from "ioredis";

/**
 * Creates an order: validates, deducts balance, creates DB record, enqueues job.
 * All DB writes happen in a single transaction â€” no nesting.
 */
export async function createOrder(
  prisma: PrismaClient,
  redis: Redis,
  queues: Queues,
  userId: string,
  serviceId: string,
  link: string,
  quantity: number,
) {
  // 1. Fetch service with provider
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    include: { provider: true },
  });

  if (!service) throw new NotFoundError("Service not found");
  // Fix: archived (soft-deleted) services/providers are not orderable
  if ((service as any).deletedAt) throw new NotFoundError("Service not found");
  if ((service.provider as any).deletedAt) throw new NotFoundError("Service not found");
  if (!service.isEnabled) throw new ForbiddenError("Service is currently disabled");
  if (!service.provider.isEnabled) throw new ForbiddenError("Provider is currently disabled");

  // 2. Validate quantity
  if (quantity < service.minQuantity || quantity > service.maxQuantity) {
    throw new ValidationError(
      `Quantity must be between ${service.minQuantity} and ${service.maxQuantity}`,
    );
  }

  // 3. Calculate cost: sellingPriceUsd is per-unit price
  // e.g. $4.20/1000 â†’ sellingPriceUsd = 0.0042 â†’ cost for 988 = 0.0042 Ã— 988 = $4.15
  const sellingPrice = new Decimal(service.sellingPriceUsd.toString());
  const costUsd = sellingPrice.times(quantity).toDecimalPlaces(8);

  // 4. Get current INR rate snapshot
  const effectiveRate = await getEffectiveInrRate(redis, prisma);
  const inrRate = new Decimal(effectiveRate);

  // 5. Single transaction: check balance, deduct, create order + ledger entry
  const { order } = await prisma.$transaction(async (tx) => {
    // Row-level lock to prevent concurrent overdraft
    const rows = await tx.$queryRaw<Array<{ walletBalance: string }>>`
      SELECT "walletBalance" FROM "users"
      WHERE id = ${userId}
      FOR UPDATE
    `;
    if (!rows[0]) throw new Error("User not found");

    const balance = new Decimal(rows[0].walletBalance);
    if (balance.lessThan(costUsd)) {
      throw new InsufficientBalanceError(
        `Insufficient balance. Required $${costUsd.toFixed(2)}, available $${balance.toFixed(2)}`,
      );
    }

    const newBalance = balance.minus(costUsd);

    // Deduct wallet
    await tx.user.update({
      where: { id: userId },
      data: { walletBalance: newBalance.toDecimalPlaces(8).toNumber() },
    });

    // Create order
    const newOrder = await tx.order.create({
      data: {
        userId,
        serviceId,
        link,
        quantity,
        costUsd: costUsd.toNumber(),
        inrRateAtOrder: inrRate.toDecimalPlaces(4).toNumber(),
        status: "PENDING",
      },
    });

    // Create ledger transaction record
    await tx.transaction.create({
      data: {
        userId,
        orderId: newOrder.id,
        type: "ORDER_CHARGE" as TransactionType,
        amountUsd: costUsd.negated().toDecimalPlaces(8).toNumber(),
        inrRate: inrRate.toDecimalPlaces(4).toNumber(),
        description: `Order #${newOrder.id.slice(-8)} â€” ${service.name}`,
        balanceBefore: balance.toDecimalPlaces(8).toNumber(),
        balanceAfter: newBalance.toDecimalPlaces(8).toNumber(),
      },
    });

    return { order: newOrder };
  });

  // 6. Enqueue for forwarding to provider
  // Fix 5: deterministic jobId = orderId — recovery logic uses this same ID
  await queues.orderForward.add(
    "forward",
    { orderId: order.id },
    {
      jobId: order.id,   // deterministic — prevents duplicate queue entries
      attempts: 5,
      backoff: { type: "exponential", delay: 3000 },
    },
  );

  return {
    orderId: order.id,
    costUsd: costUsd.toFixed(8),
    costInr: costUsd.times(inrRate).toFixed(2),
    status: order.status,
  };
}
