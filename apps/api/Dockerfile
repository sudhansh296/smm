# ── Stage 1: Dependencies ─────────────────────────────────────
FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* turbo.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/queue/package.json ./packages/queue/
COPY packages/types/package.json ./packages/types/

RUN pnpm install --frozen-lockfile

# ── Stage 2: Build ────────────────────────────────────────────
FROM deps AS builder
WORKDIR /app

COPY packages/types ./packages/types
COPY packages/db ./packages/db
COPY packages/queue ./packages/queue
COPY apps/api ./apps/api

RUN pnpm --filter @nexussmm/db run generate
RUN pnpm --filter @nexussmm/api run build

# ── Stage 3: Production ───────────────────────────────────────
FROM node:20-alpine AS runner
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma
COPY --from=builder /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=builder /app/packages/db/package.json ./packages/db/

WORKDIR /app/apps/api

EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy --schema ../../packages/db/prisma/schema.prisma && node dist/server.js"]
