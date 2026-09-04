import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { createQueues, type Queues } from "@nexussmm/queue";

declare module "fastify" {
  interface FastifyInstance {
    queues: Queues;
  }
}

export default fp(async (fastify: FastifyInstance) => {
  const queues = createQueues(fastify.redis);
  fastify.decorate("queues", queues);

  fastify.addHook("onClose", async () => {
    await Promise.all([
      queues.orderForward.close(),
      queues.statusPoll.close(),
      queues.refill.close(),
      queues.exchangeRateSync.close(),
    ]);
  });
});
