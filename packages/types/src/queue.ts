export interface OrderForwardJobData {
  orderId: string;
}

export interface StatusPollJobData {
  // Empty — worker queries DB for all open orders
  _?: never;
}

export interface RefillJobData {
  orderId: string;
}

export interface ExchangeRateSyncJobData {
  // Empty — triggered by cron
  _?: never;
}

export type QueueName =
  | "order-forward"
  | "status-poll"
  | "refill"
  | "exchange-rate-sync";
