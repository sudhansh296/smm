import Fastify, { type FastifyInstance } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyFormbody from "@fastify/formbody";
import rawBody from "fastify-raw-body";

import prismaPlugin from "./plugins/prisma.plugin.js";
import redisPlugin from "./plugins/redis.plugin.js";
import authPlugin from "./plugins/auth.plugin.js";
import maintenancePlugin from "./plugins/maintenance.plugin.js";
import queuesPlugin from "./plugins/queues.plugin.js";

import { env } from "./lib/env.js";
import { AppError, ValidationError } from "./lib/errors.js";
import { ZodError } from "zod";

// Route imports
import authRoutes from "./routes/auth/index.js";
import userRoutes from "./routes/user/index.js";
import serviceRoutes from "./routes/services/index.js";
import orderRoutes from "./routes/orders/index.js";
import depositRoutes from "./routes/deposits/index.js";
import webhookRoutes from "./routes/webhooks/index.js";
import adminRoutes from "./routes/admin/index.js";
import apiV2Routes from "./routes/v2/api.js";

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
    },
    trustProxy: true,
    disableRequestLogging: false,
  });

  // -- Core plugins (order matters) --------------------------------------
  await fastify.register(prismaPlugin);
  await fastify.register(redisPlugin);
  await fastify.register(authPlugin);

  // Raw body  --  needed for Razorpay/Cryptomus webhook HMAC signature verification
  await fastify.register(rawBody, {
    field: "rawBody",    // add rawBody to request object
    global: false,       // only on routes that set config.rawBody = true
    encoding: "utf8",
    runFirst: true,      // parse raw body before JSON
  });

  // form-urlencoded support  --  required for API v2 (standard SMM panel format)
  await fastify.register(fastifyFormbody);

  await fastify.register(fastifyCors, {
    origin: [env.FRONTEND_URL],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  await fastify.register(fastifyRateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    redis: fastify.redis,
    keyGenerator: (request) =>
      request.ip ?? request.headers["x-forwarded-for"]?.toString() ?? "unknown",
    errorResponseBuilder: () => ({
      error: "Too many requests. Please slow down.",
      code: "RATE_LIMITED",
    }),
  });

  await fastify.register(maintenancePlugin);
  await fastify.register(queuesPlugin);

  // -- Global error handler ----------------------------------------------
  fastify.setErrorHandler((error, request, reply) => {
    // Known application errors (NotFound, Unauthorized, Validation, etc.)
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
      });
    }

    // Zod validation errors thrown via .parse()  --  must return 400 not 500
    if (error instanceof ZodError) {
      const firstIssue = error.issues[0];
      const message = firstIssue
        ? `${firstIssue.path.join(".") || "input"}: ${firstIssue.message}`
        : "Validation failed";
      return reply.status(400).send({
        error: message,
        code: "VALIDATION_ERROR",
        details: error.issues,
      });
    }

    // Fastify built-in schema validation errors
    if (error.validation) {
      return reply.status(400).send({
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: error.validation,
      });
    }

    // Rate limit
    if (error.statusCode === 429) {
      return reply.status(429).send({
        error: "Too many requests",
        code: "RATE_LIMITED",
      });
    }

    // Everything else  --  log internally, return generic message
    fastify.log.error({ err: error, reqId: request.id }, "Unhandled error");
    return reply.status(500).send({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  });

  // -- Routes ------------------------------------------------------------
  await fastify.register(authRoutes, { prefix: "/auth" });
  await fastify.register(userRoutes, { prefix: "/user" });
  await fastify.register(serviceRoutes, { prefix: "/services" });
  await fastify.register(orderRoutes, { prefix: "/orders" });
  await fastify.register(depositRoutes, { prefix: "/deposits" });
  await fastify.register(webhookRoutes, { prefix: "/webhooks" });
  await fastify.register(adminRoutes, { prefix: "/admin" });
  await fastify.register(apiV2Routes); // mounts at /api/v2

  // -- Health check ------------------------------------------------------
  fastify.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  return fastify;
}