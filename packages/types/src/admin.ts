export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  walletBalance: string;
  walletBalanceInr: string;
  totalOrders: number;
  totalSpentUsd: string;
  isAdmin: boolean;
  isSuspended: boolean;
  emailVerified: boolean;
  createdAt: string;
}

export interface AdminOrder {
  id: string;
  userId: string;
  userEmail: string;
  serviceId: string;
  serviceName: string;
  providerName: string;
  link: string;
  quantity: number;
  costUsd: string;
  status: string;
  providerOrderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminTransaction {
  id: string;
  userId: string;
  userEmail: string;
  type: string;
  amountUsd: string;
  amountInr: string | null;
  description: string;
  createdAt: string;
}

export interface AdminTransactionSummary {
  totalDepositsUsd: string;
  totalOrderChargesUsd: string;
  totalRefundsUsd: string;
}

export interface CurrencySettingsData {
  manualInrRate: string;
  markupPercent: string;
  effectiveRate: string;
  autoUpdateEnabled: boolean;
  autoUpdateFreq: "hourly" | "daily";
  lastFetchedRate: string | null;
  lastFetchedAt: string | null;
  source: "manual" | "auto";
}

export interface SiteSettingsData {
  siteName: string;
  logoUrl: string | null;
  maintenanceMode: boolean;
}
