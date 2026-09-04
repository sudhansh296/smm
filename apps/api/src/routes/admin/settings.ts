import type { FastifyInstance } from "fastify";
import { z } from "zod";

const MAINTENANCE_CACHE_KEY = "maintenance:mode";

export default async function adminSettingsRoute(fastify: FastifyInstance) {
  fastify.get(
    "/settings",
    { preHandler: [fastify.authenticateAdmin] },
    async (_request, reply) => {
      const settings = await fastify.prisma.siteSettings.findUniqueOrThrow({
        where: { id: "singleton" },
      });
      return reply.send(settings);
    },
  );

  fastify.put(
    "/settings",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const data = z
        .object({
          siteName: z.string().min(1).max(100).optional(),
          logoUrl: z.string().url().nullable().optional(),
          maintenanceMode: z.boolean().optional(),
        })
        .parse(request.body);

      const settings = await fastify.prisma.siteSettings.update({
        where: { id: "singleton" },
        data: {
          ...(data.siteName !== undefined && { siteName: data.siteName }),
          ...(data.logoUrl !== undefined && { logoUrl: data.logoUrl }),
          ...(data.maintenanceMode !== undefined && { maintenanceMode: data.maintenanceMode }),
        },
      });

      // Invalidate maintenance mode cache
      if (data.maintenanceMode !== undefined) {
        await fastify.redis.set(
          MAINTENANCE_CACHE_KEY,
          data.maintenanceMode ? "1" : "0",
          "EX",
          30,
        );
      }

      return reply.send(settings);
    },
  );
}
