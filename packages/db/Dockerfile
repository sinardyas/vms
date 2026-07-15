# syntax=docker/dockerfile:1
# --- Soechi VMS DB migrate + seed runner -----------------------------------------
# Build context is the REPO ROOT. Runs `drizzle-kit migrate` then the seed entrypoint
# against $DATABASE_URL. Used as a one-shot `migrate` service that must complete before
# the API starts (see docker-compose.yml). Idempotent — safe to re-run.
#
# Runtime EXTENDS `deps` so packages/db/node_modules/.bin/drizzle-kit (an isolated
# per-package install) is present; source is merged on top (source has no node_modules).
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

FROM deps AS runtime
ENV NODE_ENV=production
COPY packages/db ./packages/db
WORKDIR /app/packages/db
# migrate (apply committed SQL) then seed (connectivity check today; data later).
CMD ["sh", "-c", "bun run migrate && bun run seed"]
