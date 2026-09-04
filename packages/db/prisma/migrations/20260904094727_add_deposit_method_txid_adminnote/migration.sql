-- AlterTable
ALTER TABLE "deposit_requests" ADD COLUMN     "adminNote" TEXT,
ADD COLUMN     "method" TEXT NOT NULL DEFAULT 'AUTO',
ADD COLUMN     "txId" TEXT;

-- CreateIndex
CREATE INDEX "deposit_requests_method_idx" ON "deposit_requests"("method");
