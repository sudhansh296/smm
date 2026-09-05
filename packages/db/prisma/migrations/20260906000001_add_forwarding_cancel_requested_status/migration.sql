-- Add FORWARDING and CANCEL_REQUESTED to OrderStatus enum
-- FORWARDING: order is being sent to provider — do not re-send on BullMQ retry
-- CANCEL_REQUESTED: user requested cancel — awaiting provider confirmation before refund
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'FORWARDING';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'CANCEL_REQUESTED';
