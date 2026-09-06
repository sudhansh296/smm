import type { FastifyInstance } from "fastify";
import { Decimal } from "decimal.js";
import { getEffectiveInrRate } from "../services/currency.service.js";

const PLATFORM_MAP: Record<string, string> = {
  instagram: "Instagram",
  youtube: "YouTube",
  telegram: "Telegram",
  facebook: "Facebook",
  twitch: "Twitch",
  twitter: "Twitter",
  tiktok: "TikTok",
  vk: "VK",
  other: "Other",
};

function getPlatform(categoryName: string): string {
  const lower = categoryName.toLowerCase();
  for (const [key, val] of Object.entries(PLATFORM_MAP)) {
    if (lower.includes(key)) return val;
  }
  return "Other";
}

export default async function publicServicesRoute(fastify: FastifyInstance) {
  fastify.get("/public/services", async (_request, reply) => {
    const [allServices, categories, effectiveRate] = await Promise.all([
      fastify.prisma.service.findMany({
        where: {
          isEnabled: true,
          deletedAt: null,
          provider: { isEnabled: true, deletedAt: null } as never,
        },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
        include: { category: { select: { id: true, name: true } } },
      }),
      fastify.prisma.category.findMany({ orderBy: { displayOrder: "asc" } }),
      getEffectiveInrRate(fastify.redis, fastify.prisma),
    ]);

    // Pick 1 representative service per platform (mid-range price)
    const byPlatform: Record<string, any[]> = {};
    for (const service of allServices) {
      const platform = getPlatform((service as any).category.name);
      if (!byPlatform[platform]) byPlatform[platform] = [];
      byPlatform[platform].push(service);
    }

    const featuredByPlatform: Record<string, any> = {};
    for (const [platform, services] of Object.entries(byPlatform)) {
      // Pick service from middle of list (not cheapest, not most expensive)
      const mid = services[Math.floor(services.length / 2)];
      const s = mid as any;
      featuredByPlatform[platform] = {
        id: s.id,
        name: s.name,
        categoryName: s.category.name,
        platform,
        sellingPriceUsd: s.sellingPriceUsd.toString(),
        sellingPriceInr: new Decimal(s.sellingPriceUsd.toString()).times(effectiveRate).toFixed(2),
        minQuantity: s.minQuantity,
        maxQuantity: s.maxQuantity,
        supportsRefill: s.supportsRefill,
      };
    }

    // Platform summary with top category names
    const platformSummary = Object.entries(byPlatform).map(([platform, services]) => {
      const catNames = [...new Set(services.map((s: any) =>
        s.category.name
          .replace(/\[.*?\]/g, "")
          .replace(/[^\w\s&]/g, "")
          .replace(/\s+/g, " ")
          .trim()
      ))].filter(Boolean).slice(0, 4);

      return {
        platform,
        serviceCount: services.length,
        topCategories: catNames,
        featuredService: featuredByPlatform[platform],
      };
    }).sort((a, b) => b.serviceCount - a.serviceCount);

    return reply.send({
      categories: categories.map((c: any) => ({ id: c.id, name: c.name })),
      platformSummary,
      featuredServices: Object.values(featuredByPlatform),
      effectiveInrRate: effectiveRate.toFixed(2),
      totalServices: allServices.length,
    });
  });
}