import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getEffectiveInrRate } from "../../services/currency.service.js";
import { Decimal } from "decimal.js";

export default async function profileRoute(fastify: FastifyInstance) {
  fastify.get(
    "/profile",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = await fastify.prisma.user.findUniqueOrThrow({
        where: { id: request.user.sub },
        select: {
          id: true,
          email: true,
          displayName: true,
          emailVerified: true,
          isAdmin: true,
          totpEnabled: true,
          walletBalance: true,
          createdAt: true,
        },
      });

      const rate = await getEffectiveInrRate(fastify.redis, fastify.prisma);
      const balanceUsd = new Decimal(user.walletBalance.toString());

      return reply.send({
        ...user,
        walletBalance: balanceUsd.toFixed(8),
        walletBalanceInr: balanceUsd.times(rate).toFixed(2),
        createdAt: user.createdAt.toISOString(),
      });
    },
  );

  fastify.patch(
    "/profile",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { displayName } = z
        .object({ displayName: z.string().min(2).max(50) })
        .parse(request.body);

      const user = await fastify.prisma.user.update({
        where: { id: request.user.sub },
        data: { displayName },
        select: { id: true, displayName: true },
      });

      return reply.send(user);
    },
  );
}



