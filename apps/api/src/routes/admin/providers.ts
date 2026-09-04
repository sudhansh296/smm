import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { encryptProviderKey } from "../../lib/crypto.js";
import { ProviderClient } from "../../services/provider.service.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";

export default async function adminProvidersRoute(fastify: FastifyInstance) {
  // List providers
  fastify.get("/providers", { preHandler: [fastify.authenticateAdmin] }, async (_request, reply) => {
    const providers = await fastify.prisma.provider.findMany({
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
        .object({
          name: z.string().min(1).max(100),
          apiUrl: z.string().url(),
          apiKey: z.string().min(1),
        })
        .parse(request.body);

      const provider = await fastify.prisma.provider.create({
        data: {
          name,
          apiUrl,
          apiKeyEncrypted: encryptProviderKey(apiKey),
        },
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

      // Get global markup
      const currencySettings = await fastify.prisma.currencySettings.findUniqueOrThrow({
        where: { id: "singleton" },
      });
      const globalMarkup = new Decimal(currencySettings.markupPercent.toString());

      const client = new ProviderClient(provider);
      const providerServices = await client.getServices();

      let created = 0;
      let updated = 0;

      for (const ps of providerServices) {
        const providerServiceId = ps.service.toString();
        const costPrice = new Decimal(ps.rate).dividedBy(1000); // rate is per 1000 → per unit cost
        const costPriceUsd = costPrice; // provider rate IS per 1000 — keep as-is
        const sellingPriceUsd = costPriceUsd.times(
          new Decimal(1).plus(globalMarkup.dividedBy(100)),
        );

        const existing = await fastify.prisma.service.findUnique({
          where: {
            providerId_providerServiceId: {
              providerId: id,
              providerServiceId,
            },
          },
        });

        if (existing) {
          await fastify.prisma.service.update({
            where: { id: existing.id },
            data: {
              costPriceUsd: costPriceUsd.toDecimalPlaces(8).toNumber(),
              sellingPriceUsd: sellingPriceUsd.toDecimalPlaces(8).toNumber(),
              minQuantity: Number(ps.min),
              maxQuantity: Number(ps.max),
              supportsRefill: ps.refill ?? false,
            },
          });
          updated++;
        } else {
          // Find or create a default category
          let category = await fastify.prisma.category.findFirst({
            where: { name: ps.category },
          });
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
              sellingPriceUsd: sellingPriceUsd.toDecimalPlaces(8).toNumber(),
              minQuantity: Number(ps.min),
              maxQuantity: Number(ps.max),
              supportsRefill: ps.refill ?? false,
              isEnabled: true, // Auto-enable on sync — admin can disable individually if needed
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

      const provider = await fastify.prisma.provider.update({
        where: { id },
        data: { isEnabled },
      });

      return reply.send({ id: provider.id, isEnabled: provider.isEnabled });
    },
  );

  // Delete provider (also deletes all its services)
  fastify.delete(
    "/providers/:id",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);

      // Delete all services linked to this provider first
      const deleted = await fastify.prisma.service.deleteMany({ where: { providerId: id } });
      await fastify.prisma.provider.delete({ where: { id } });

      return reply.send({
        message: `Provider deleted along with ${deleted.count} services`,
      });
    },
  );
}

