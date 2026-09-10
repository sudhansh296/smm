-- Fix migration 20260910000001: drop the partial index created by the migration file.
-- The correct normal composite unique index was already applied by db push:
-- CREATE UNIQUE INDEX "deposit_requests_method_txId_key" ON "deposit_requests"("method", "txId")
-- PostgreSQL allows multiple NULLs in a normal unique index, so txId=NULL rows are unaffected.
DROP INDEX IF EXISTS "deposit_requests_txId_method_unique";