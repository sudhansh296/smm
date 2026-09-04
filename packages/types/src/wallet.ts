export type TransactionType =
  | "DEPOSIT_INR"
  | "DEPOSIT_USDT"
  | "ORDER_CHARGE"
  | "REFUND"
  | "ADMIN_ADJUSTMENT";

export interface Transaction {
  id: string;
  type: TransactionType;
  amountUsd: string;
  amountInr: string | null;
  inrRate: string | null;
  description: string;
  balanceBefore: string;
  balanceAfter: string;
  orderId: string | null;
  createdAt: string;
}

export interface TransactionListQuery {
  page?: number;
  limit?: number;
  type?: TransactionType;
  dateFrom?: string;
  dateTo?: string;
}

export interface TransactionListResponse {
  transactions: Transaction[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface WalletBalance {
  balanceUsd: string;
  balanceInr: string;
  effectiveInrRate: string;
}

export interface InitiateRazorpayDepositInput {
  amountInr: number;
}

export interface RazorpayDepositResponse {
  razorpayOrderId: string;
  amountInr: number;
  currency: "INR";
  keyId: string;
}

export interface InitiateCryptomusDepositInput {
  amountUsdt: number;
}

export interface CryptomusDepositResponse {
  invoiceId: string;
  paymentAddress: string;
  amountUsdt: string;
  currency: string;
  network: string;
  expiresAt: string;
}
