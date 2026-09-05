-- Add RefundStatus enum and fields to orders table
CREATE TYPE "RefundStatus" AS ENUM ('REFUND_PENDING', 'REFUND_APPROVED', 'REFUND_CANCELLED');

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "refundStatus" "RefundStatus",
  ADD COLUMN IF NOT EXISTS "refundNote"   TEXT;

CREATE INDEX IF NOT EXISTS "orders_refundStatus_idx" ON "orders"("refundStatus");