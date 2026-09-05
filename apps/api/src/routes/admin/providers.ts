import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { encryptProviderKey } from "../../lib/crypto.js";
import { ProviderClient } from "../../services/provider.service.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";

export default async function adminProvidersRoute(fastify: FastifyInstance) {
  // List providers — exclude soft-deleted
  fastify.get("/providers", { preHandler: [fastify.authenticateAdmin] }, async (_request, reply) => {
    const providers = await fastify.prisma.provider.findMany({
      where: { deletedAt: null } as never,
      include: { _count: { select: { services: true } } },
      orderBy: { createdAt: "desc" },
    });
    return reply.send(
      providers.map((p: any) => ({
        id: p.id,
        name: p.name,
        apiUrl: p.apiUrl,
        isEnabled: p.isEnabled,
        serviceCount: p._count.services,
        createdAt: p.createdAt.toISOString(),
      })),
    );
  });

  // Add provider
  fastify.post(
    "/providers",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { name, apiUrl, apiKey } = z
        .object({ name: z.string().min(1).max(100), apiUrl: z.string().url(), apiKey: z.string().min(1) })
        .parse(request.body);

      const provider = await fastify.prisma.provider.create({
        data: { name, apiUrl, apiKeyEncrypted: encryptProviderKey(apiKey) },
      });
      return reply.status(201).send({ id: provider.id, name: provider.name });
    },
  );

  // Test provider connectivity
  fastify.post(
    "/providers/:id/test",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const provider = await fastify.prisma.provider.findUnique({ where: { id } });
      if (!provider) throw new NotFoundError("Provider not found");
      const client = new ProviderClient(provider);
      const ok = await client.testConnectivity();
      return reply.send({ ok, message: ok ? "Provider reachable" : "Provider unreachable" });
    },
  );

  // Sync services from provider
  fastify.post(
    "/providers/:id/sync",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const provider = await fastify.prisma.provider.findUnique({ where: { id } });
      if (!provider) throw new NotFoundError("Provider not found");

      const currencySettings = await fastify.prisma.currencySettings.findUniqueOrThrow({
        where: { id: "singleton" },
      }) as any;
      // Use serviceMarkupPercent for selling price — not depositMarkupPercent
      const globalMarkup = new Decimal(
        currencySettings.serviceMarkupPercent?.toString() ??
        currencySettings.markupPercent?.toString() ?? "0"
      );

      const client = new ProviderClient(provider);
      const providerServices = await client.getServices();

      let created = 0;
      let updated = 0;

      for (const ps of providerServices) {
        const providerServiceId = ps.service.toString();
        const costPriceUsd = new Decimal(ps.rate).dividedBy(1000);
        // Selling price using GLOBAL markup (applied to new services and services without override)
        const globalSellingPrice = costPriceUsd.times(
          new Decimal(1).plus(globalMarkup.dividedBy(100)),
        );

        const existing = await fastify.prisma.service.findUnique({
          where: { providerId_providerServiceId: { providerId: id, providerServiceId } },
        });

        if (existing) {
          // Preserve per-service markupOverride — only apply global markup when no override is set
          let effectiveSellingPrice: Decimal;
          if (existing.markupOverride !== null) {
            // Service has a custom markup override — recalculate using that, not the global one
            const overrideMultiplier = new Decimal(1).plus(
              new Decimal(existing.markupOverride.toString()).dividedBy(100),
            );
            effectiveSellingPrice = costPriceUsd.times(overrideMultiplier).toDecimalPlaces(8);
          } else {
            // No override — use global serviceMarkupPercent
            effectiveSellingPrice = globalSellingPrice;
          }

          await fastify.prisma.service.update({
            where: { id: existing.id },
            data: {
              costPriceUsd: costPriceUsd.toDecimalPlaces(8).toNumber(),
              sellingPriceUsd: effectiveSellingPrice.toDecimalPlaces(8).toNumber(),
              minQuantity: Number(ps.min),
              maxQuantity: Number(ps.max),
              supportsRefill: ps.refill ?? false,
              // Fix #4: preserve existing supportsCancel if provider doesn't send the field
              supportsCancel: (ps as any).cancel !== undefined ? Boolean((ps as any).cancel) : existing.supportsCancel,
              // markupOverride intentionally NOT touched — preserved as-is
            },
          });
          updated++;
        } else {
          let category = await fastify.prisma.category.findFirst({ where: { name: ps.category } });
          if (!category) {
            category = await fastify.prisma.category.create({
              data: { name: ps.category, displayOrder: 99 },
            });
          }
          await fastify.prisma.service.create({
            data: {
              name: ps.name,
              description: "",
              categoryId: category.id,
              providerId: id,
              providerServiceId,
              costPriceUsd: costPriceUsd.toDecimalPlaces(8).toNumber(),
              sellingPriceUsd: globalSellingPrice.toDecimalPlaces(8).toNumber(),
              minQuantity: Number(ps.min),
              maxQuantity: Number(ps.max),
              supportsRefill: ps.refill ?? false,
              // Fix #4: default false for new services — safer than assuming cancel works
              supportsCancel: (ps as any).cancel !== undefined ? Boolean((ps as any).cancel) : false,
              isEnabled: true,
            },
          });
          created++;
        }
      }

      return reply.send({
        message: `Sync complete: ${created} created, ${updated} updated`,
        created,
        updated,
      });
    },
  );

  // Toggle provider enabled/disabled
  fastify.patch(
    "/providers/:id/toggle",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const { isEnabled } = z.object({ isEnabled: z.boolean() }).parse(request.body);
      const provider = await fastify.prisma.provider.update({ where: { id }, data: { isEnabled } });
      return reply.send({ id: provider.id, isEnabled: provider.isEnabled });
    },
  );

  // Soft-delete provider — disables it and all its services, sets deletedAt
  // Hard delete would fail when orders reference services from this provider
  fastify.delete(
    "/providers/:id",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);

      const provider = await fastify.prisma.provider.findUnique({ where: { id } });
      if (!provider) throw new NotFoundError("Provider not found");

      const now = new Date();

      // Soft-delete all services under this provider (disable + mark deleted)
      const softDeleted = await fastify.prisma.service.updateMany({
        where: { providerId: id, deletedAt: null } as never,
        data: { isEnabled: false, deletedAt: now } as never,
      });

      // Soft-delete the provider itself
      await fastify.prisma.provider.update({
        where: { id },
        data: { isEnabled: false, deletedAt: now } as never,
      });

      return reply.send({
        message: `Provider archived along with ${softDeleted.count} services`,
        servicesArchived: softDeleted.count,
      });
    },
  );
}