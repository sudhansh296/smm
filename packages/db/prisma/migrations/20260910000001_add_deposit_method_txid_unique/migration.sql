-- Add unique constraint on (method, txId) to prevent duplicate UTR/TxHash submissions
-- txId is nullable so automatic deposits (Razorpay/Cryptomus) with txId=NULL are unaffected
CREATE UNIQUE INDEX IF NOT EXISTS "deposit_requests_method_txId_key" ON "deposit_requests"("method", "txId") WHERE "txId" IS NOT NULL;