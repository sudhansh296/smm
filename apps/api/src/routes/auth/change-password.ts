import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { verifyPassword, hashPassword } from "../../services/auth.service.js";
import { UnauthorizedError, ValidationError } from "../../lib/errors.js";

const schema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters").max(128),
});

export default async function changePasswordRoute(fastify: FastifyInstance) {
  fastify.post(
    "/change-password",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message ?? "Invalid input");
      }

      const { currentPassword, newPassword } = parsed.data;
      const userId = request.user.sub;

      const user = await fastify.prisma.user.findUnique({ where: { id: userId } });
      if (!user || !user.passwordHash) {
        throw new UnauthorizedError("Account password not available");
      }

      const currentValid = await verifyPassword(currentPassword, user.passwordHash);
      if (!currentValid) {
        throw new UnauthorizedError("Current password is incorrect");
      }

      const sameAsOld = await verifyPassword(newPassword, user.passwordHash);
      if (sameAsOld) {
        throw new ValidationError("New password must be different from current password");
      }

      const passwordHash = await hashPassword(newPassword);

      await fastify.prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { passwordHash } });
        // Revoke all other sessions after password change
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      });

      return reply.send({ message: "Password changed successfully" });
    },
  );
}