import { Decimal } from "decimal.js";
import type { PrismaClient, TransactionType } from "@nexussmm/db";
import { InsufficientBalanceError, AlreadyRefundedError } from "../lib/errors.js";

// ── Types ─────────────────────────────────────────────────────────────────────

type TxClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

interface CreditOptions {
  type: TransactionType;
  description: string;
  orderId?: string;
  amountInr?: Decimal;
  inrRate?: Decimal;
  paymentGatewayId?: string;
}

interface RefundOrderOptions {
  userId: string;
  amountUsd: Decimal;
  inrRate: Decimal;
  description: string;
}

// ── Internal helpers (accept existing tx client — no nested transactions) ─────

/**
 * Credits wallet inside an EXISTING transaction.
 * Use this from workers/services that are already inside prisma.$transaction().
 */
export async function creditWalletTx(
  tx: TxClient,
  userId: string,
  amountUsd: Decimal,
  options: CreditOptions,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ walletBalance: string }>>`
    SELECT "walletBalance" FROM "users" WHERE id = ${userId} FOR UPDATE
  `;
  if (!rows[0]) throw new Error("User not found");

  const balance = new Decimal(rows[0].walletBalance);
  const newBalance = balance.plus(amountUsd);

  await tx.user.update({
    where: { id: userId },
    data: { walletBalance: newBalance.toDecimalPlaces(8).toNumber() },
  });

  await tx.transaction.create({
    data: {
      userId,
      orderId: options.orderId ?? null,
      type: options.type,
      amountUsd: amountUsd.toDecimalPlaces(8).toNumber(),
      amountInr: options.amountInr?.toDecimalPlaces(4).toNumber() ?? null,
      inrRate: options.inrRate?.toDecimalPlaces(4).toNumber() ?? null,
      description: options.description,
      balanceBefore: balance.toDecimalPlaces(8).toNumber(),
      balanceAfter: newBalance.toDecimalPlaces(8).toNumber(),
      paymentGatewayId: options.paymentGatewayId ?? null,
    },
  });
}

/**
 * Deducts wallet inside an EXISTING transaction.
 * Use this from workers/services that are already inside prisma.$transaction().
 */
export async function deductWalletTx(
  tx: TxClient,
  userId: string,
  orderId: string,
  amountUsd: Decimal,
  inrRate: Decimal,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ walletBalance: string }>>`
    SELECT "walletBalance" FROM "users" WHERE id = ${userId} FOR UPDATE
  `;
  if (!rows[0]) throw new Error("User not found");

  const balance = new Decimal(rows[0].walletBalance);
  if (balance.lessThan(amountUsd)) {
    throw new InsufficientBalanceError(
      `Insufficient balance. Required $${amountUsd.toFixed(2)}, available $${balance.toFixed(2)}`,
    );
  }

  const newBalance = balance.minus(amountUsd);

  await tx.user.update({
    where: { id: userId },
    data: { walletBalance: newBalance.toDecimalPlaces(8).toNumber() },
  });

  await tx.transaction.create({
    data: {
      userId,
      orderId,
      type: "ORDER_CHARGE" as TransactionType,
      amountUsd: amountUsd.negated().toDecimalPlaces(8).toNumber(),
      inrRate: inrRate.toDecimalPlaces(4).toNumber(),
      description: "Order charge",
      balanceBefore: balance.toDecimalPlaces(8).toNumber(),
      balanceAfter: newBalance.toDecimalPlaces(8).toNumber(),
    },
  });
}

/**
 * Unified refund function inside an EXISTING transaction.
 * Checks orders.refundedAt — if already set, throws "already refunded".
 * Sets refundedAt + refundedAmountUsd on the order, then credits wallet.
 * Uses a single idempotency key: "refund:<orderId>"
 */
export async function refundOrderTx(
  tx: TxClient,
  orderId: string,
  options: RefundOrderOptions,
): Promise<void> {
  // Row-lock the order and check refundedAt atomically
  const rows = await tx.$queryRaw<Array<{ refundedAt: Date | null }>>`
    SELECT "refundedAt" FROM "orders" WHERE id = ${orderId} FOR UPDATE
  `;
  if (!rows[0]) throw new Error(`Order ${orderId} not found`);
  if (rows[0].refundedAt !== null) {
    // Throw typed error so callers can distinguish "already refunded" from genuine DB errors
    throw new AlreadyRefundedError(orderId);
  }

  // Mark refunded on the order
  await (tx as any).order.update({
    where: { id: orderId },
    data: {
      refundedAt: new Date(),
      refundedAmountUsd: options.amountUsd.toDecimalPlaces(8).toNumber(),
    },
  });

  // Credit wallet using unified idempotency key
  await creditWalletTx(tx, options.userId, options.amountUsd, {
    type: "REFUND",
    description: options.description,
    orderId,
    inrRate: options.inrRate,
    paymentGatewayId: `refund:${orderId}`,
  });
}

// ── Public API (starts its own transaction) ───────────────────────────────────

/**
 * Atomically credits user wallet. Used for deposits and standalone refunds.
 * Starts its own transaction — do NOT call from inside another transaction.
 */
export async function creditWallet(
  prisma: PrismaClient,
  userId: string,
  amountUsd: Decimal,
  options: CreditOptions,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await creditWalletTx(tx as unknown as TxClient, userId, amountUsd, options);
  });
}

/**
 * Atomically deducts order cost from user wallet.
 * Starts its own transaction — do NOT call from inside another transaction.
 */
export async function deductForOrder(
  prisma: PrismaClient,
  userId: string,
  orderId: string,
  amountUsd: Decimal,
  inrRate: Decimal,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await deductWalletTx(tx as unknown as TxClient, userId, orderId, amountUsd, inrRate);
  });
}

/**
 * Admin balance adjustment (positive or negative).
 * Starts its own transaction — do NOT call from inside another transaction.
 */
export async function adminAdjustWallet(
  prisma: PrismaClient,
  userId: string,
  amountUsd: Decimal,
  reason: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ walletBalance: string }>>`
      SELECT "walletBalance" FROM "users" WHERE id = ${userId} FOR UPDATE
    `;
    if (!rows[0]) throw new Error("User not found");

    const balance = new Decimal(rows[0].walletBalance);
    const newBalance = balance.plus(amountUsd);

    if (newBalance.lessThan(0)) {
      throw new InsufficientBalanceError("Adjustment would result in negative balance");
    }

    await tx.user.update({
      where: { id: userId },
      data: { walletBalance: newBalance.toDecimalPlaces(8).toNumber() },
    });

    await tx.transaction.create({
      data: {
        userId,
        type: "ADMIN_ADJUSTMENT" as TransactionType,
        amountUsd: amountUsd.toDecimalPlaces(8).toNumber(),
        description: reason || "Admin wallet adjustment",
        balanceBefore: balance.toDecimalPlaces(8).toNumber(),
        balanceAfter: newBalance.toDecimalPlaces(8).toNumber(),
      },
    });
  });
}