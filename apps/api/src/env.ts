/**
 * Process env, read once at boot. Full config/validation conventions land with the domain
 * foundation (ticket #6); this is the minimal set the scaffold needs.
 */
const nodeEnv = process.env.NODE_ENV ?? "development";

export const env = {
  port: Number(process.env.PORT ?? 3001),
  nodeEnv,
  databaseUrl: process.env.DATABASE_URL ?? "postgres://vms:vms@localhost:5432/vms",

  /**
   * Enable the walking-skeleton dev actor (#8) — a fake authenticated principal that lets the
   * end-to-end spine run before M1 auth exists. Requires an explicit opt-in AND a non-production
   * `NODE_ENV`, so the staging overlay (which pins `NODE_ENV=production`) can never turn it on.
   */
  devActor: process.env.DEV_ACTOR === "1" && nodeEnv !== "production",

  /** Browser origins allowed to call the API (the console / portal SPAs, served from other ports). */
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:3002")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
};
