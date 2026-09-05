-- Soft delete support for services and providers
-- Hard deletes fail when historical orders reference services
ALTER TABLE "services"  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP;
