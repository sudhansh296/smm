import type { FastifyInstance } from "fastify";

export default async function notificationsRoute(fastify: FastifyInstance) {
  fastify.get(
    "/notifications",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const notifications = await fastify.prisma.notification.findMany({
        where: { userId: request.user.sub },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return reply.send({ notifications });
    },
  );

  fastify.patch(
    "/notifications/:id/read",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await fastify.prisma.notification.updateMany({
        where: { id, userId: request.user.sub },
        data: { isRead: true },
      });
      return reply.send({ ok: true });
    },
  );
}




