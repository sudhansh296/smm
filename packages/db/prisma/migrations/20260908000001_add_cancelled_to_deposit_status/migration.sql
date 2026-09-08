-- Add CANCELLED value to DepositStatus enum
ALTER TYPE "DepositStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';