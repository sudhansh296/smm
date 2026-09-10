-- Add unique constraint on (method, txId) to prevent duplicate UTR/TxHash submissions.
-- txId is nullable; PostgreSQL allows multiple NULLs in a normal unique index,
-- so automatic deposits (Razorpay/Cryptomus) with txId=NULL are unaffected.
CREATE UNIQUE INDEX "deposit_requests_method_txId_key"
ON "deposit_requests"("method", "txId");