/**
 * Standard SMM Panel API v2 types.
 * These match the industry-standard spec used by smm.plus, JustAnotherPanel, etc.
 * All reseller bots expect exactly these shapes.
 */

export type ApiV2Action =
  | "services"
  | "add"
  | "status"
  | "multi_status"
  | "refill"
  | "refill_status"
  | "cancel"
  | "balance";

export interface ApiV2Request {
  key: string;
  action: ApiV2Action;
  service?: string;
  link?: string;
  quantity?: string;
  order?: string;
  orders?: string; // comma-separated
  refill?: string;
  refills?: string; // comma-separated
  // drip-feed fields (optional)
  runs?: string;
  interval?: string;
}

export interface ApiV2ServiceItem {
  service: string;
  name: string;
  type: string;
  category: string;
  rate: string; // USD per 1000 units
  min: number;
  max: number;
  refill: boolean;
  cancel: boolean;
}

export interface ApiV2OrderStatusItem {
  charge: string;
  start_count: number;
  status: string;
  remains: number;
  currency: "USD";
}

export interface ApiV2AddResponse {
  order: string;
}

export interface ApiV2BalanceResponse {
  balance: string;
  currency: "USD";
}

export interface ApiV2RefillResponse {
  refill: string;
}

export interface ApiV2RefillStatusResponse {
  status: string;
}

export interface ApiV2CancelItem {
  order: string;
  cancel: number | { error: string };
}

export interface ApiV2ErrorResponse {
  error: string;
}
