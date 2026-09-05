import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { NotFoundError } from "../../lib/errors.js";

export default async function adminServicesRoute(fastify: FastifyInstance) {
  // List all services — exclude soft-deleted
  fastify.get("/services", { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { categoryId, providerId } = z
      .object({ categoryId: z.string().optional(), providerId: z.string().optional() })
      .parse(request.query);

    const services = await fastify.prisma.service.findMany({
      where: {
        deletedAt: null,
        ...(categoryId && { categoryId }),
        ...(providerId && { providerId }),
      },
      include: {
        category: { select: { id: true, name: true } },
        provider: { select: { id: true, name: true } },
      },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });

    return reply.send(
      services.map((s: any) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        categoryId: s.categoryId,
        categoryName: s.category.name,
        providerId: s.providerId,
        providerName: s.provider.name,
        providerServiceId: s.providerServiceId,
        costPriceUsd: s.costPriceUsd.toString(),
        sellingPriceUsd: s.sellingPriceUsd.toString(),
        markupOverride: s.markupOverride?.toString() ?? null,
        minQuantity: s.minQuantity,
        maxQuantity: s.maxQuantity,
        isEnabled: s.isEnabled,
        supportsRefill: s.supportsRefill,
        displayOrder: s.displayOrder,
        backupProviderId: s.backupProviderId ?? null,
        backupProviderServiceId: s.backupProviderServiceId ?? null,
      })),
    );
  });

  // Edit service
  fastify.patch(
    "/services/:id",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);

      const data = z
        .object({
          name: z.string().min(1).optional(),
          description: z.string().optional(),
          categoryId: z.string().optional(),
          minQuantity: z.coerce.number().int().positive().optional(),
          maxQuantity: z.coerce.number().int().positive().optional(),
          isEnabled: z.boolean().optional(),
          supportsRefill: z.boolean().optional(),
          markupOverride: z.coerce.number().min(0).max(500).nullable().optional(),
          manualSellingPriceUsd: z.coerce.number().positive().nullable().optional(),
          backupProviderId: z.string().nullable().optional(),
          backupProviderServiceId: z.string().nullable().optional(),
        })
        .parse(request.body);

      const service = await fastify.prisma.service.findUnique({ where: { id } });
      if (!service) throw new NotFoundError("Service not found");

      let sellingPriceUsd: number | undefined;

      if (data.manualSellingPriceUsd !== undefined && data.manualSellingPriceUsd !== null) {
        sellingPriceUsd = data.manualSellingPriceUsd;
      } else if (data.markupOverride !== undefined) {
        const currencySettings = await fastify.prisma.currencySettings.findUniqueOrThrow({
          where: { id: "singleton" },
        }) as any;
        const markup =
          data.markupOverride !== null
            ? new Decimal(data.markupOverride)
            : new Decimal(currencySettings.serviceMarkupPercent ?? currencySettings.markupPercent);
        sellingPriceUsd = new Decimal(service.costPriceUsd.toString())
          .times(new Decimal(1).plus(markup.dividedBy(100)))
          .toDecimalPlaces(8)
          .toNumber();
      }

      const updated = await fastify.prisma.service.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.categoryId !== undefined && { categoryId: data.categoryId }),
          ...(data.minQuantity !== undefined && { minQuantity: data.minQuantity }),
          ...(data.maxQuantity !== undefined && { maxQuantity: data.maxQuantity }),
          ...(data.isEnabled !== undefined && { isEnabled: data.isEnabled }),
          ...(data.supportsRefill !== undefined && { supportsRefill: data.supportsRefill }),
          ...(data.markupOverride !== undefined && data.markupOverride !== null && { markupOverride: data.markupOverride }),
          ...(data.markupOverride === null && { markupOverride: null }),
          ...(sellingPriceUsd !== undefined && { sellingPriceUsd }),
          ...(data.backupProviderId !== undefined && { backupProviderId: data.backupProviderId }),
          ...(data.backupProviderServiceId !== undefined && { backupProviderServiceId: data.backupProviderServiceId }),
        } as never,
      });

      return reply.send({ id: updated.id, message: "Service updated" });
    },
  );

  // Toggle enable/disable
  fastify.patch(
    "/services/:id/toggle",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const { isEnabled } = z.object({ isEnabled: z.boolean() }).parse(request.body);
      const service = await fastify.prisma.service.update({
        where: { id },
        data: { isEnabled },
      });
      return reply.send({ id: service.id, isEnabled: service.isEnabled });
    },
  );

  // Reorder services
  fastify.put(
    "/services/reorder",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { order } = z
        .object({ order: z.array(z.object({ id: z.string(), displayOrder: z.number() })) })
        .parse(request.body);

      await fastify.prisma.$transaction(
        order.map((item: any) =>
          fastify.prisma.service.update({
            where: { id: item.id },
            data: { displayOrder: item.displayOrder },
          }),
        ),
      );

      return reply.send({ message: "Display order updated" });
    },
  );

  // Soft-delete service — sets deletedAt + disables instead of hard DELETE
  // Hard delete fails when historical orders reference this service row
  fastify.delete(
    "/services/:id",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      await fastify.prisma.service.update({
        where: { id },
        data: { isEnabled: false, deletedAt: new Date() } as never,
      });
      return reply.send({ message: "Service deleted" });
    },
  );
}