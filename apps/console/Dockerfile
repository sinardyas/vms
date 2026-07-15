# syntax=docker/dockerfile:1
# --- Soechi VMS Staff Console (React + Vite, static) -----------------------------
# Build context is the REPO ROOT. Vite bakes VITE_API_URL at build time, so it is a
# build arg; the built static assets are served by a tiny Bun server (docker/serve.ts).
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

FROM deps AS build
ARG VITE_API_URL=http://localhost:3001
ENV VITE_API_URL=${VITE_API_URL}
COPY tsconfig.base.json ./tsconfig.base.json
COPY packages ./packages
COPY apps/console ./apps/console
RUN cd apps/console && bun run build

FROM oven/bun:${BUN_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080 STATIC_ROOT=/app/dist
COPY --from=build /app/apps/console/dist ./dist
COPY docker/serve.ts ./serve.ts
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
  CMD bun -e "fetch('http://localhost:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "run", "serve.ts"]
