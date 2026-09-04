-- Add fulfillmentProviderId to orders
-- Tracks which provider actually fulfilled each order (primary or backup)
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "fulfillmentProviderId" TEXT;
