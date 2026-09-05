import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getEffectiveInrRate } from "../../services/currency.service.js";
import { Decimal } from "decimal.js";

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(300).default(50),
  search: z.string().optional(),
  categoryId: z.string().optional(),
});

export default async function serviceRoutes(fastify: FastifyInstance) {
  // Public service catalog (requires auth)
  fastify.get(
    "/",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const q = querySchema.parse(request.query);
      const skip = (q.page - 1) * q.limit;

      const where = {
        isEnabled: true,
        deletedAt: null,
        ...(q.categoryId && { categoryId: q.categoryId }),
        ...(q.search && {
          OR: [
            { name: { contains: q.search, mode: "insensitive" as const } },
            { description: { contains: q.search, mode: "insensitive" as const } },
          ],
        }),
      };

      const [services, total, categories] = await Promise.all([
        fastify.prisma.service.findMany({
          where,
          orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
          skip,
          take: q.limit,
          include: {
            category: { select: { id: true, name: true } },
          },
        }),
        fastify.prisma.service.count({ where }),
        fastify.prisma.category.findMany({
          orderBy: { displayOrder: "asc" },
        }),
      ]);

      const effectiveRate = await getEffectiveInrRate(fastify.redis, fastify.prisma);

      return reply.send({
        services: services.map((s: typeof services[number]) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          categoryId: s.categoryId,
          categoryName: s.category.name,
          sellingPriceUsd: s.sellingPriceUsd.toString(),
          sellingPriceInr: new Decimal(s.sellingPriceUsd.toString())
            .times(effectiveRate)
            .toFixed(2),
          minQuantity: s.minQuantity,
          maxQuantity: s.maxQuantity,
          supportsRefill: s.supportsRefill,
          displayOrder: s.displayOrder,
        })),
        categories: categories.map((c: { id: string; name: string; displayOrder: number }) => ({
          id: c.id,
          name: c.name,
          displayOrder: c.displayOrder,
        })),
        total,
        page: q.page,
        limit: q.limit,
        totalPages: Math.ceil(total / q.limit),
        effectiveInrRate: effectiveRate.toFixed(4),
      });
    },
  );

  // Single service detail
  fastify.get(
    "/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);

      const service = await fastify.prisma.service.findUnique({
        where: { id, isEnabled: true },
        include: { category: { select: { id: true, name: true } } },
      });

      if (!service) {
        return reply.status(404).send({ error: "Service not found" });
      }

      const effectiveRate = await getEffectiveInrRate(fastify.redis, fastify.prisma);

      return reply.send({
        id: service.id,
        name: service.name,
        description: service.description,
        categoryId: service.categoryId,
        categoryName: service.category.name,
        sellingPriceUsd: service.sellingPriceUsd.toString(),
        sellingPriceInr: new Decimal(service.sellingPriceUsd.toString())
          .times(effectiveRate)
          .toFixed(2),
        minQuantity: service.minQuantity,
        maxQuantity: service.maxQuantity,
        supportsRefill: service.supportsRefill,
      });
    },
  );
}
