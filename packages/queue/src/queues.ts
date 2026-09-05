import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type {
  OrderForwardJobData,
  StatusPollJobData,
  RefillJobData,
  ExchangeRateSyncJobData,
} from "@nexussmm/types";

export interface Queues {
  orderForward: Queue<OrderForwardJobData>;
  statusPoll: Queue<StatusPollJobData>;
  refill: Queue<RefillJobData>;
  exchangeRateSync: Queue<ExchangeRateSyncJobData>;
  orderCancel: Queue<{ orderId: string }>;
}

export function createQueues(redis: Redis): Queues {
  const connection = redis;
  // skipVersionCheck: allows running on Redis < 6.2 (development only)
  const jobOptions = { skipVersionCheck: true } as never;

  const orderForward = new Queue<OrderForwardJobData>("order-forward", {
    connection,
    skipVersionCheck: true,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 30_000, // 30s → 60s → 120s
      },
      removeOnComplete: { count: 1000, age: 60 * 60 * 24 * 7 }, // keep 7 days
      removeOnFail: { count: 500, age: 60 * 60 * 24 * 14 }, // keep 14 days
    },
  });

  const statusPoll = new Queue<StatusPollJobData>("status-poll", {
    connection,
    skipVersionCheck: true,
    defaultJobOptions: {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    },
  });

  const refill = new Queue<RefillJobData>("refill", {
    connection,
    skipVersionCheck: true,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 15_000, // 15s → 30s → 60s
      },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 200 },
    },
  });

  const exchangeRateSync = new Queue<ExchangeRateSyncJobData>("exchange-rate-sync", {
    connection,
    skipVersionCheck: true,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5_000, // 5s → 10s → 20s
      },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 20 },
    },
  });

  const orderCancel = new Queue<{ orderId: string }>("order-cancel", {
    connection,
    skipVersionCheck: true,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 10_000 }, // 10s → 20s → 40s → 80s → 160s
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 200 },
    },
  });

  return { orderForward, statusPoll, refill, exchangeRateSync, orderCancel };
}
