import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  setInrRate,
  computeEffectiveRate,
} from "../../services/currency.service.js";

export default async function adminCurrencyRoute(fastify: FastifyInstance) {
  fastify.get(
    "/currency",
    { preHandler: [fastify.authenticateAdmin] },
    async (_request, reply) => {
      const settings = await fastify.prisma.currencySettings.findUniqueOrThrow({
        where: { id: "singleton" },
      }) as any;

      const depositMarkup = Number(settings.depositMarkupPercent ?? settings.markupPercent);
      const serviceMarkup = Number(settings.serviceMarkupPercent ?? settings.markupPercent);

      const depositEffectiveRate = computeEffectiveRate(
        Number(settings.manualInrRate),
        depositMarkup,
      );

      return reply.send({
        manualInrRate: settings.manualInrRate.toString(),
        markupPercent: settings.markupPercent.toString(),
        depositMarkupPercent: depositMarkup.toString(),
        serviceMarkupPercent: serviceMarkup.toString(),
        effectiveRate: depositEffectiveRate.toFixed(4),
        autoUpdateEnabled: settings.autoUpdateEnabled,
        autoUpdateFreq: settings.autoUpdateFreq,
        lastFetchedRate: settings.lastFetchedRate?.toString() ?? null,
        lastFetchedAt: settings.lastFetchedAt?.toISOString() ?? null,
        source: settings.lastFetchedAt ? "auto" : "manual",
      });
    },
  );

  fastify.put(
    "/currency",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const data = z
        .object({
          manualInrRate: z.coerce.number().min(1).max(1000),
          depositMarkupPercent: z.coerce.number().min(0).max(100),
          serviceMarkupPercent: z.coerce.number().min(0).max(500),
          autoUpdateEnabled: z.boolean(),
          autoUpdateFreq: z.enum(["hourly", "daily"]),
        })
        .parse(request.body);

      // Update currency settings
      await fastify.prisma.$queryRaw`
        UPDATE currency_settings
        SET "manualInrRate" = ${data.manualInrRate},
            "markupPercent" = ${data.depositMarkupPercent},
            depositmarkuppercent = ${data.depositMarkupPercent},
            servicemarkuppercent = ${data.serviceMarkupPercent},
            "autoUpdateEnabled" = ${data.autoUpdateEnabled},
            "autoUpdateFreq" = ${data.autoUpdateFreq},
            "updatedAt" = NOW()
        WHERE id = 'singleton'
      `;

      // Invalidate Redis cache
      await fastify.redis.del("inr:effective_rate");

      // Re-cache deposit rate
      const depositEffective = computeEffectiveRate(data.manualInrRate, data.depositMarkupPercent);
      const ttl = data.autoUpdateFreq === "hourly" ? 3600 : 86400;
      await fastify.redis.set("inr:effective_rate", depositEffective.toString(), "EX", ttl);

      // Recalculate ALL service selling prices using serviceMarkupPercent
      const services = await fastify.prisma.service.findMany({
        where: { markupOverride: null },
        select: { id: true, costPriceUsd: true },
      });

      const overrideServices = await fastify.prisma.service.findMany({
        where: { markupOverride: { not: null } },
        select: { id: true, costPriceUsd: true, markupOverride: true },
      });

      const CHUNK = 50;
      const serviceMultiplier = 1 + data.serviceMarkupPercent / 100;

      // Update global markup services
      for (let i = 0; i < services.length; i += CHUNK) {
        const chunk = services.slice(i, i + CHUNK);
        await fastify.prisma.$transaction(
          chunk.map((s) =>
            fastify.prisma.service.update({
              where: { id: s.id },
              data: { sellingPriceUsd: parseFloat((Number(s.costPriceUsd) * serviceMultiplier).toFixed(8)) },
            }),
          ),
        );
      }

      // Update per-service override services
      for (let i = 0; i < overrideServices.length; i += CHUNK) {
        const chunk = overrideServices.slice(i, i + CHUNK);
        await fastify.prisma.$transaction(
          chunk.map((s) => {
            const overrideMultiplier = 1 + Number(s.markupOverride) / 100;
            return fastify.prisma.service.update({
              where: { id: s.id },
              data: { sellingPriceUsd: parseFloat((Number(s.costPriceUsd) * overrideMultiplier).toFixed(8)) },
            });
          }),
        );
      }

      const totalUpdated = services.length + overrideServices.length;

      return reply.send({
        message: `Settings saved. ${totalUpdated} service prices updated.`,
        depositEffectiveRate: depositEffective.toFixed(4),
        servicesUpdated: totalUpdated,
      });
    },
  );
}
