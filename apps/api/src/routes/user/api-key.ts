import type { FastifyInstance } from "fastify";
import { generateApiKey } from "../../lib/crypto.js";

export default async function apiKeyRoute(fastify: FastifyInstance) {
  // Get masked API key
  fastify.get(
    "/api-key",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const key = await fastify.prisma.apiKey.findUnique({
        where: { userId: request.user.sub },
      });

      if (!key || key.revokedAt) {
        return reply.send({ hasKey: false });
      }

      return reply.send({
        hasKey: true,
        maskedKey: `${"*".repeat(56)}${key.lastEight}`,
        createdAt: key.createdAt.toISOString(),
      });
    },
  );

  // Generate new API key (invalidates existing)
  fastify.post(
    "/api-key",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { raw, hash, lastEight } = generateApiKey();

      // Delete existing key
      await fastify.prisma.apiKey.deleteMany({ where: { userId: request.user.sub } });

      // Create new key
      await fastify.prisma.apiKey.create({
        data: {
          userId: request.user.sub,
          keyHash: hash,
          lastEight,
        },
      });

      // Return raw key ONCE  --  never stored in plain text
      return reply.status(201).send({
        apiKey: raw,
        message: "Save this key  --  it will not be shown again.",
      });
    },
  );

  // Revoke API key
  fastify.delete(
    "/api-key",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      await fastify.prisma.apiKey.updateMany({
        where: { userId: request.user.sub, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      return reply.send({ message: "API key revoked" });
    },
  );
}




