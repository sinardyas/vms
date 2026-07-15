# Soechi VMS — monorepo

Turborepo + Bun + TypeScript monorepo for the Soechi Vendor Management System (Phase 0). Planning and
scope live in [`docs/`](docs/) and the [wayfinder map](https://github.com/sinardyas/vms/issues/1).

## Layout
```
apps/
  api        Bun + Hono HTTP API (imports @vms/db)
  portal     React + Vite — vendor-facing portal
  console    React + Vite — internal staff console
packages/
  db         Drizzle schema + Postgres client (existing)
  domain     framework-agnostic domain core (result/error, types, i18n) — filled in #6
  ui         React design system — filled in #4/#5
```

## Commands (run from repo root)
```bash
bun install          # install the whole workspace
bun run dev          # turbo: start api + portal + console
bun run typecheck    # turbo: tsc --noEmit across every package
bun run check        # biome lint + format check
bun run build        # turbo: build all buildable packages
```

Stack (ADR-0003): Bun + Hono · React + TS · PostgreSQL + Drizzle · Turborepo · MinIO · better-auth.
Everything targets Docker (see ticket #3).

## Docker (the deploy substrate)

The whole stack runs in Docker — the substrate for local dev, UAT staging, and later production.
Copy `.env.example` → `.env` to customise; a bare `docker compose up` works with dev defaults too.

```bash
docker compose up -d --build                    # Postgres + MinIO + Mailpit + migrate/seed + api/portal/console
docker compose up -d postgres minio mailpit     # infra only (then run apps with `bun run dev`)
docker compose down -v                          # stop + wipe volumes
```

Once up:

| Service | URL | Notes |
|---|---|---|
| API | http://localhost:3001/health | `/health/db` proves the migrated DB is reachable |
| Vendor portal | http://localhost:3000 | static SPA (Vite build served by Bun) |
| Staff console | http://localhost:3002 | static SPA |
| Mailpit | http://localhost:8025 | SMTP sink + web viewer for UAT account emails |
| MinIO console | http://localhost:9001 | file storage; bucket `vms-documents` auto-created |
| Postgres | localhost:5432 | user/db `vms` |

Bring-up order is enforced by healthchecks: Postgres + MinIO become healthy → the one-shot **migrate**
service runs `drizzle-kit migrate` then the seed (connectivity check today; seed content lands with
later tickets) → the API starts only after migrate completes → portal/console follow. `migrate` is
idempotent — safe to re-run.

**Staging / production** promote the *same images* via an env-parameterised overlay (required secrets,
real SMTP, restart policies):

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d --build
```

Out of scope here (post-M6): TLS termination, off-host backups, secret-manager wiring.
