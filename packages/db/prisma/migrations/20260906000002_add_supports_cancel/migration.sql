-- Add supportsCancel to services
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "supportsCancel" BOOLEAN NOT NULL DEFAULT true;
