-- Migration: partial unique index on deposit_requests (txId, method) where txId is not null
CREATE UNIQUE INDEX IF NOT EXISTS "deposit_requests_txId_method_unique"
ON deposit_requests("txId", method)
WHERE "txId" IS NOT NULL;
