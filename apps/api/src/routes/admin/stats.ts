import type { FastifyInstance } from "fastify";
import { Decimal } from "decimal.js";

export default async function adminStatsRoute(fastify: FastifyInstance) {
  fastify.get(
    "/stats",
    { preHandler: [fastify.authenticateAdmin] },
    async (_request, reply) => {
      const now = new Date();
      const day = 24 * 60 * 60 * 1000;

      const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(now.getTime() - (6 - i) * day);
        return {
          label: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
          from: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0),
          to:   new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59),
        };
      });

      const [dailyOrders, dailyRevenue, statusBreakdown, topServices] = await Promise.all([
        Promise.all(
          days.map((d) =>
            fastify.prisma.order.count({
              where: { createdAt: { gte: d.from, lte: d.to } },
            }).then((count) => ({ date: d.label, orders: count })),
          ),
        ),
        Promise.all(
          days.map((d) =>
            fastify.prisma.transaction.aggregate({
              where: { type: "ORDER_CHARGE", createdAt: { gte: d.from, lte: d.to } },
              _sum: { amountUsd: true },
            }).then((r) => ({
              date: d.label,
              revenue: parseFloat(Math.abs(new Decimal(r._sum.amountUsd?.toString() ?? "0").toNumber()).toFixed(2)),
            })),
          ),
        ),
        fastify.prisma.order.groupBy({
          by: ["status"],
          _count: { _all: true },
        }).then((rows) => rows.map((r) => ({ status: r.status, count: r._count._all }))),
        fastify.prisma.order.groupBy({
          by: ["serviceId"],
          _count: { _all: true },
          orderBy: { _count: { serviceId: "desc" } },
          take: 5,
        }).then(async (rows) => {
          const ids = rows.map((r) => r.serviceId);
          const services = await fastify.prisma.service.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true },
          });
          const nameMap = Object.fromEntries(services.map((s) => [s.id, s.name]));
          return rows.map((r) => ({
            name: (nameMap[r.serviceId] ?? r.serviceId).slice(0, 28),
            orders: r._count._all,
          }));
        }),
      ]);

      const [totalRevenue, totalRefunds, totalDeposits, pendingOrders] = await Promise.all([
        fastify.prisma.transaction.aggregate({ where: { type: "ORDER_CHARGE" }, _sum: { amountUsd: true } })
          .then((r) => Math.abs(new Decimal(r._sum.amountUsd?.toString() ?? "0").toNumber()).toFixed(2)),
        fastify.prisma.transaction.aggregate({ where: { type: "REFUND" }, _sum: { amountUsd: true } })
          .then((r) => new Decimal(r._sum.amountUsd?.toString() ?? "0").toNumber().toFixed(2)),
        fastify.prisma.transaction.aggregate({ where: { type: { in: ["DEPOSIT_INR", "DEPOSIT_USDT"] } }, _sum: { amountUsd: true } })
          .then((r) => new Decimal(r._sum.amountUsd?.toString() ?? "0").toNumber().toFixed(2)),
        fastify.prisma.order.count({ where: { status: "PENDING" } }),
      ]);

      return reply.send({ dailyOrders, dailyRevenue, statusBreakdown, topServices, summary: { totalRevenue, totalRefunds, totalDeposits, pendingOrders } });
    },
  );
}
