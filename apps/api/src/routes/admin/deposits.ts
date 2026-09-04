import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { getEffectiveInrRate } from "../../services/currency.service.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";

export default async function adminDepositsRoute(fastify: FastifyInstance) {
  // List all deposits
  fastify.get("/deposits", { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const q = z.object({
      page: z.coerce.number().min(1).default(1),
      limit: z.coerce.number().min(1).max(100).default(20),
      status: z.string().optional(),
      method: z.string().optional(),
    }).parse(request.query);

    const where: any = {
      ...(q.status && { status: q.status }),
      ...(q.method && q.method !== "ALL" && { method: q.method }),
    };

    const [deposits, total, pendingCount] = await Promise.all([
      fastify.prisma.depositRequest.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        include: { user: { select: { email: true, displayName: true } } },
      }),
      fastify.prisma.depositRequest.count({ where }),
      fastify.prisma.depositRequest.count({ where: { status: "PENDING" } }),
    ]);

    return reply.send({
      deposits: deposits.map((d: any) => ({
        id: d.id,
        userId: d.userId,
        userEmail: d.user.email,
        userName: d.user.displayName,
        amountInr: d.amountInr?.toString() ?? null,
        amountUsdt: d.amountUsdt?.toString() ?? null,
        amountUsd: d.amountUsd?.toString() ?? d.amountUsdt?.toString() ?? null,
        method: d.method ?? "AUTO",
        gateway: d.gateway,
        status: d.status,
        txId: d.txId ?? null,
        adminNote: d.adminNote ?? null,
        createdAt: d.createdAt.toISOString(),
      })),
      total,
      page: q.page,
      totalPages: Math.ceil(total / q.limit),
      pendingCount,
    });
  });

  // Approve deposit — credit wallet
  fastify.post("/deposits/:id/approve", { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { note } = z.object({ note: z.string().optional() }).parse(request.body);

    const deposit = await fastify.prisma.depositRequest.findUnique({
      where: { id },
      include: { user: { select: { email: true } } },
    }) as any;

    if (!deposit) throw new NotFoundError("Deposit not found");
    if (deposit.status === "COMPLETED") throw new ValidationError("Already approved");
    if (deposit.status === "FAILED") throw new ValidationError("Cannot approve a rejected deposit");

    const isUsdt = deposit.method === "MANUAL_USDT" || deposit.gateway === "cryptomus";
    const effectiveRate = await getEffectiveInrRate(fastify.redis, fastify.prisma);

    const amountUsd = isUsdt
      ? new Decimal(deposit.amountUsdt ?? deposit.amountUsd ?? 0)
      : new Decimal(deposit.amountInr ?? 0).dividedBy(effectiveRate);

    const txType = isUsdt ? "DEPOSIT_USDT" : "DEPOSIT_INR";

    await fastify.prisma.$transaction(async (tx) => {
      await tx.depositRequest.update({
        where: { id },
        data: { status: "COMPLETED", ...(note && { adminNote: note }) } as any,
      });

      const rows = await tx.$queryRaw<Array<{ walletBalance: string }>>`
        SELECT "walletBalance" FROM "users" WHERE id = ${deposit.userId} FOR UPDATE
      `;
      const balance = new Decimal(rows[0].walletBalance);
      const newBalance = balance.plus(amountUsd);

      await tx.user.update({
        where: { id: deposit.userId },
        data: { walletBalance: newBalance.toDecimalPlaces(8).toNumber() },
      });

      await tx.transaction.create({
        data: {
          userId: deposit.userId,
          type: txType,
          amountUsd: amountUsd.toDecimalPlaces(8).toNumber(),
          amountInr: !isUsdt ? new Decimal(deposit.amountInr ?? 0).toDecimalPlaces(4).toNumber() : null,
          inrRate: !isUsdt ? new Decimal(effectiveRate).toDecimalPlaces(4).toNumber() : null,
          description: `${deposit.method} deposit approved by admin`,
          balanceBefore: balance.toDecimalPlaces(8).toNumber(),
          balanceAfter: newBalance.toDecimalPlaces(8).toNumber(),
          paymentGatewayId: `admin_${id}_${Date.now()}`,
        },
      });

      await tx.notification.create({
        data: {
          userId: deposit.userId,
          message: `Your deposit of $${amountUsd.toFixed(2)} has been approved. Wallet credited!`,
        },
      });
    });

    return reply.send({
      message: `Approved. $${amountUsd.toFixed(2)} credited to ${deposit.user.email}`,
      amountUsd: amountUsd.toFixed(2),
    });
  });

  // Reject deposit
  fastify.post("/deposits/:id/reject", { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { reason } = z.object({ reason: z.string().min(1, "Reason required") }).parse(request.body);

    const deposit = await fastify.prisma.depositRequest.findUnique({ where: { id } }) as any;
    if (!deposit) throw new NotFoundError("Deposit not found");
    if (deposit.status !== "PENDING") throw new ValidationError("Only pending deposits can be rejected");

    await fastify.prisma.depositRequest.update({
      where: { id },
      data: { status: "FAILED", adminNote: reason } as any,
    });

    await fastify.prisma.notification.create({
      data: {
        userId: deposit.userId,
        message: `Your deposit request was rejected. Reason: ${reason}`,
      },
    });

    return reply.send({ message: "Deposit rejected" });
  });
}
