import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { env } from "../lib/env.js";

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
  }
}

export default fp(async (fastify: FastifyInstance) => {
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 100, 3000),
    lazyConnect: false,
  });

  redis.on("error", (err) => {
    fastify.log.error({ err }, "Redis connection error");
  });

  redis.on("connect", () => {
    fastify.log.info("Redis connected");
  });

  fastify.decorate("redis", redis);

  fastify.addHook("onClose", async () => {
    await redis.quit();
  });
});
