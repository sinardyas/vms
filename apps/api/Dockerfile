# syntax=docker/dockerfile:1
# --- Soechi VMS API (Hono on Bun) -------------------------------------------------
# Build context is the REPO ROOT (see docker-compose.yml) so the whole Bun workspace
# is available for install. Bun uses an isolated install layout (per-package
# node_modules), so the runtime stage EXTENDS `deps` — which already carries every
# workspace's node_modules — and merges source on top (source has no node_modules;
# see .dockerignore), rather than cherry-picking a single root node_modules.
ARG BUN_VERSION=1.3.14

FROM oven/bun:${BUN_VERSION} AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/portal/package.json apps/portal/package.json
COPY apps/console/package.json apps/console/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN bun install --frozen-lockfile

# --- runtime: Bun runs the TS entrypoint directly (workspace deps already installed)
FROM deps AS runtime
ENV NODE_ENV=production
COPY tsconfig.base.json ./tsconfig.base.json
COPY packages ./packages
COPY apps/api ./apps/api
WORKDIR /app/apps/api
ENV PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD bun -e "fetch('http://localhost:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "run", "src/index.ts"]
