-- AlterTable: Add separate deposit and service markup columns
-- Note: columns added via raw SQL with lowercase names, @map used in schema
ALTER TABLE "currency_settings"
  ADD COLUMN IF NOT EXISTS "depositmarkuppercent" DECIMAL(5,2) NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "servicemarkuppercent" DECIMAL(5,2) NOT NULL DEFAULT 10;
