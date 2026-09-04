import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createOrder } from "../../services/order.service.js";
import { ValidationError } from "../../lib/errors.js";

const createOrderSchema = z.object({
  serviceId: z.string().min(1),
  link: z.string().url("Must be a valid URL").min(1),
  quantity: z.coerce.number().int().positive(),
});

export default async function orderRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parsed = createOrderSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message ?? "Invalid input");
      }

      const { serviceId, link, quantity } = parsed.data;

      const result = await createOrder(
        fastify.prisma,
        fastify.redis,
        fastify.queues,
        request.user.sub,
        serviceId,
        link,
        quantity,
      );

      return reply.status(201).send(result);
    },
  );
}




