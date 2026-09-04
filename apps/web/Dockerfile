# ── Stage 1: Dependencies ─────────────────────────────────────
FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* turbo.json tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/types/package.json ./packages/types/

RUN pnpm install --frozen-lockfile

# ── Stage 2: Build ────────────────────────────────────────────
FROM deps AS builder
WORKDIR /app

COPY packages/types ./packages/types
COPY apps/web ./apps/web

ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter @nexussmm/web run build

# ── Stage 3: Production ───────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
