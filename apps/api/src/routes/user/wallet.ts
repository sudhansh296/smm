import type { FastifyInstance } from "fastify";
import { getEffectiveInrRate } from "../../services/currency.service.js";
import { Decimal } from "decimal.js";

export default async function walletRoute(fastify: FastifyInstance) {
  fastify.get(
    "/wallet",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = await fastify.prisma.user.findUniqueOrThrow({
        where: { id: request.user.sub },
        select: { walletBalance: true },
      });

      const rate = await getEffectiveInrRate(fastify.redis, fastify.prisma);
      const balanceUsd = new Decimal(user.walletBalance.toString());

      return reply.send({
        balanceUsd: balanceUsd.toFixed(8),
        balanceInr: balanceUsd.times(rate).toFixed(2),
        effectiveInrRate: rate.toFixed(4),
      });
    },
  );
}



