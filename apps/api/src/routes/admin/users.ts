import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { adminAdjustWallet } from "../../services/wallet.service.js";
import { getEffectiveInrRate } from "../../services/currency.service.js";
import { NotFoundError } from "../../lib/errors.js";

export default async function adminUsersRoute(fastify: FastifyInstance) {
  // List users
  fastify.get("/users", { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const q = z
      .object({
        page: z.coerce.number().min(1).default(1),
        limit: z.coerce.number().min(1).max(100).default(20),
        search: z.string().optional(),
      })
      .parse(request.query);

    const skip = (q.page - 1) * q.limit;
    const where = q.search
      ? {
          OR: [
            { email: { contains: q.search, mode: "insensitive" as const } },
            { displayName: { contains: q.search, mode: "insensitive" as const } },
          ],
        }
      : {};

    const rate = await getEffectiveInrRate(fastify.redis, fastify.prisma);

    const [users, total] = await Promise.all([
      fastify.prisma.user.findMany({
        where,
        skip,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          displayName: true,
          walletBalance: true,
          isAdmin: true,
          isSuspended: true,
          emailVerified: true,
          createdAt: true,
          _count: { select: { orders: true } },
        },
      }),
      fastify.prisma.user.count({ where }),
    ]);

    return reply.send({
      users: users.map((u: any) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        walletBalance: u.walletBalance.toString(),
        walletBalanceInr: new Decimal(u.walletBalance.toString()).times(rate).toFixed(2),
        totalOrders: u._count.orders,
        isAdmin: u.isAdmin,
        isSuspended: u.isSuspended,
        emailVerified: u.emailVerified,
        createdAt: u.createdAt.toISOString(),
      })),
      total,
      page: q.page,
      limit: q.limit,
      totalPages: Math.ceil(total / q.limit),
    });
  });

  // Adjust wallet balance
  fastify.patch(
    "/users/:id/wallet",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const { amountUsd, reason } = z
        .object({
          amountUsd: z.coerce.number().min(-10000).max(10000),
          reason: z.string().min(1).max(200),
        })
        .parse(request.body);

      const user = await fastify.prisma.user.findUnique({ where: { id } });
      if (!user) throw new NotFoundError("User not found");

      await adminAdjustWallet(fastify.prisma, id, new Decimal(amountUsd), reason);

      return reply.send({ message: "Wallet adjusted" });
    },
  );

  // Suspend / unsuspend
  fastify.patch(
    "/users/:id/suspend",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const { isSuspended } = z.object({ isSuspended: z.boolean() }).parse(request.body);

      await fastify.prisma.$transaction(async (tx: Parameters<Parameters<typeof fastify.prisma.$transaction>[0]>[0]) => {
        await tx.user.update({ where: { id }, data: { isSuspended } });
        if (isSuspended) {
          await tx.refreshToken.updateMany({
            where: { userId: id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
      });

      return reply.send({ message: isSuspended ? "User suspended" : "User unsuspended" });
    },
  );

  // User history (orders + transactions)
  fastify.get(
    "/users/:id/history",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);

      const [orders, transactions] = await Promise.all([
        fastify.prisma.order.findMany({
          where: { userId: id },
          orderBy: { createdAt: "desc" },
          take: 50,
          include: { service: { select: { name: true } } },
        }),
        fastify.prisma.transaction.findMany({
          where: { userId: id },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
      ]);

      return reply.send({ orders, transactions });
    },
  );
  // Unlock account
  fastify.post("/users/:id/unlock", { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const user = await fastify.prisma.user.findUnique({ where: { id }, select: { id: true, email: true } });
    if (!user) throw new NotFoundError("User not found");
    await fastify.prisma.user.update({ where: { id }, data: { lockedUntil: null, failedLoginAttempts: 0 } });
    const lower = user.email.toLowerCase();
    await fastify.redis.del(`session:lock:${lower}`);
    await fastify.redis.del(`rl:login:${lower}`);
    return reply.send({ message: "Account unlocked" });
  });

  // Manually verify email
  fastify.post("/users/:id/verify-email", { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const user = await fastify.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw new NotFoundError("User not found");
    await fastify.prisma.user.update({ where: { id }, data: { emailVerified: true } });
    return reply.send({ message: "Email verified" });
  });

}