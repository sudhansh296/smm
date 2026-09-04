import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";
import { creditWalletTx } from "../../services/wallet.service.js";

export default async function adminDepositsRoute(fastify: FastifyInstance) {
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
        where, skip: (q.page - 1) * q.limit, take: q.limit,
        orderBy: { createdAt: "desc" },
        include: { user: { select: { email: true, displayName: true } } },
      }),
      fastify.prisma.depositRequest.count({ where }),
      fastify.prisma.depositRequest.count({ where: { status: "PENDING" } }),
    ]);

    return reply.send({
      deposits: deposits.map((d: any) => ({
        id: d.id, userId: d.userId, userEmail: d.user.email, userName: d.user.displayName,
        amountInr: d.amountInr?.toString() ?? null,
        amountUsdt: d.amountUsdt?.toString() ?? null,
        amountUsd: d.amountUsd?.toString() ?? d.amountUsdt?.toString() ?? null,
        method: d.method ?? "AUTO", gateway: d.gateway, status: d.status,
        txId: d.txId ?? null, adminNote: d.adminNote ?? null,
        createdAt: d.createdAt.toISOString(),
      })),
      total, page: q.page, totalPages: Math.ceil(total / q.limit), pendingCount,
    });
  });

  // Approve deposit — atomic, idempotent, race-safe, uses snapshot rate
  fastify.post("/deposits/:id/approve", { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { note } = z.object({ note: z.string().optional() }).parse(request.body);

    // Idempotency key — unique constraint on paymentGatewayId prevents double-credit
    const idempotencyKey = `admin-deposit-approve:${id}`;

    let approvedAmount = "";
    let approvedEmail = "";

    await fastify.prisma.$transaction(async (tx) => {
      // Row-lock deposit to prevent concurrent approvals
      const deposits = await tx.$queryRaw<Array<{
        id: string; status: string; method: string | null; gateway: string | null;
        amountInr: string | null; amountUsdt: string | null; userId: string;
        inrRateSnapshot: string | null; email: string;
      }>>`
        SELECT d.id, d.status, d.method, d.gateway, d."amountInr", d."amountUsdt",
               d."userId", d."inrRateSnapshot", u.email
        FROM deposit_requests d
        JOIN users u ON u.id = d."userId"
        WHERE d.id = ${id}
        FOR UPDATE
      `;

      const deposit = deposits[0];
      if (!deposit) throw new NotFoundError("Deposit not found");
      if (deposit.status === "COMPLETED") throw new ValidationError("Already approved");
      if (deposit.status === "FAILED") throw new ValidationError("Cannot approve a rejected deposit");

      // Check idempotency — if already credited (shouldn't happen but guard)
      const existing = await tx.transaction.findUnique({ where: { paymentGatewayId: idempotencyKey } });
      if (existing) throw new ValidationError("Already approved");

      const isUsdt = deposit.method === "MANUAL_USDT" || deposit.gateway === "cryptomus";

      // Use snapshot rate if available — never current rate (fixes #10/#11)
      let amountUsd: Decimal;
      if (isUsdt) {
        amountUsd = new Decimal(deposit.amountUsdt ?? "0");
      } else if (deposit.inrRateSnapshot) {
        // Use the rate that was in effect when the deposit was created
        amountUsd = new Decimal(deposit.amountInr ?? "0").dividedBy(new Decimal(deposit.inrRateSnapshot));
      } else {
        // Fallback: only if no snapshot (old deposits before fix)
        const settings = await tx.currencySettings.findUniqueOrThrow({ where: { id: "singleton" } }) as any;
        const rate = new Decimal(settings.depositMarkupPercent ?? settings.markupPercent ?? 0);
        const baseRate = new Decimal(settings.manualInrRate.toString());
        const effectiveRate = baseRate.times(new Decimal(1).plus(rate.dividedBy(100)));
        amountUsd = new Decimal(deposit.amountInr ?? "0").dividedBy(effectiveRate);
      }

      const txType = isUsdt ? "DEPOSIT_USDT" : "DEPOSIT_INR";

      await tx.depositRequest.update({
        where: { id },
        data: { status: "COMPLETED", ...(note && { adminNote: note }) } as any,
      });

      await creditWalletTx(
        tx as Parameters<typeof creditWalletTx>[0],
        deposit.userId,
        amountUsd,
        {
          type: txType,
          description: `${deposit.method ?? "Manual"} deposit approved by admin`,
          amountInr: !isUsdt && deposit.amountInr ? new Decimal(deposit.amountInr) : undefined,
          inrRate: !isUsdt && deposit.inrRateSnapshot ? new Decimal(deposit.inrRateSnapshot) : undefined,
          paymentGatewayId: idempotencyKey,
        },
      );

      await tx.notification.create({
        data: { userId: deposit.userId, message: `Your deposit of $${amountUsd.toFixed(2)} has been approved. Wallet credited!` },
      });

      approvedAmount = amountUsd.toFixed(2);
      approvedEmail = deposit.email;
    });

    return reply.send({ message: `Approved. $${approvedAmount} credited to ${approvedEmail}`, amountUsd: approvedAmount });
  });

  fastify.post("/deposits/:id/reject", { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { reason } = z.object({ reason: z.string().min(1, "Reason required") }).parse(request.body);

    const deposit = await fastify.prisma.depositRequest.findUnique({ where: { id } }) as any;
    if (!deposit) throw new NotFoundError("Deposit not found");
    if (deposit.status !== "PENDING") throw new ValidationError("Only pending deposits can be rejected");

    await fastify.prisma.depositRequest.update({ where: { id }, data: { status: "FAILED", adminNote: reason } as any });
    await fastify.prisma.notification.create({ data: { userId: deposit.userId, message: `Your deposit request was rejected. Reason: ${reason}` } });

    return reply.send({ message: "Deposit rejected" });
  });
}