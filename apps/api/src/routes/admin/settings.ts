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
          // Bank transfer details
          bankAccountName:   z.string().max(100).nullable().optional(),
          bankAccountNumber: z.string().max(30).nullable().optional(),
          bankIfsc:          z.string().max(20).nullable().optional(),
          bankName:          z.string().max(100).nullable().optional(),
          upiId:             z.string().max(100).nullable().optional(),
          // USDT wallet addresses
          usdtTrc20: z.string().max(100).nullable().optional(),
          usdtErc20: z.string().max(100).nullable().optional(),
          usdtBep20: z.string().max(100).nullable().optional(),
        })
        .parse(request.body);

      const settings = await fastify.prisma.siteSettings.update({
        where: { id: "singleton" },
        data: {
          ...(data.siteName !== undefined && { siteName: data.siteName }),
          ...(data.logoUrl !== undefined && { logoUrl: data.logoUrl }),
          ...(data.maintenanceMode !== undefined && { maintenanceMode: data.maintenanceMode }),
          ...(data.bankAccountName !== undefined && { bankAccountName: data.bankAccountName }),
          ...(data.bankAccountNumber !== undefined && { bankAccountNumber: data.bankAccountNumber }),
          ...(data.bankIfsc !== undefined && { bankIfsc: data.bankIfsc }),
          ...(data.bankName !== undefined && { bankName: data.bankName }),
          ...(data.upiId !== undefined && { upiId: data.upiId }),
          ...(data.usdtTrc20 !== undefined && { usdtTrc20: data.usdtTrc20 }),
          ...(data.usdtErc20 !== undefined && { usdtErc20: data.usdtErc20 }),
          ...(data.usdtBep20 !== undefined && { usdtBep20: data.usdtBep20 }),
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