-- Add refundedAt and refundedAmountUsd to orders
-- Used by refundOrderTx() to prevent double-refund across all paths
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "refundedAt" TIMESTAMP;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "refundedAmountUsd" DECIMAL(18,8);
