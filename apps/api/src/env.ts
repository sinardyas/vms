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

  // --- Auth (M1.1, #20) ------------------------------------------------------
  /**
   * better-auth signing secret. Required in production (the boot check below throws without it);
   * a fixed dev fallback keeps `bun run dev` and tests turnkey without leaking a real secret.
   */
  betterAuthSecret:
    process.env.BETTER_AUTH_SECRET ?? "dev-only-insecure-secret-change-in-production",
  /** The API's own public base URL — better-auth builds verification/reset links against it. */
  betterAuthUrl:
    process.env.BETTER_AUTH_URL ?? `http://localhost:${Number(process.env.PORT ?? 3001)}`,
  /** Where email links land the user after verifying / resetting — the vendor portal by default. */
  portalUrl: process.env.APP_PORTAL_URL ?? "http://localhost:3000",
  /** The staff console origin — where an admin-invited internal user lands to set their password (M1.5). */
  consoleUrl: process.env.APP_CONSOLE_URL ?? "http://localhost:3002",

  // --- SMTP (M1.1) — Mailpit in dev; a real authenticated host via the staging overlay ----------
  smtpHost: process.env.SMTP_HOST ?? "localhost",
  smtpPort: Number(process.env.SMTP_PORT ?? 1025),
  smtpFrom: process.env.SMTP_FROM ?? "no-reply@vms.local",
  /** Implicit TLS (port 465). Off for Mailpit / STARTTLS relays (587), which negotiate upward. */
  smtpSecure: process.env.SMTP_SECURE === "true",
  /** SMTP credentials — absent for Mailpit (accepts anything); required by real relays in staging. */
  smtpUser: process.env.SMTP_USER,
  smtpPass: process.env.SMTP_PASS,
};

// Fail fast in production if the auth secret was left at its insecure dev default (ADR-0015).
if (env.nodeEnv === "production" && !process.env.BETTER_AUTH_SECRET) {
  throw new Error("BETTER_AUTH_SECRET must be set in production");
}
