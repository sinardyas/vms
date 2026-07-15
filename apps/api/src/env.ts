/**
 * Process env, read once at boot. Full config/validation conventions land with the domain
 * foundation (ticket #6); this is the minimal set the scaffold needs.
 */
export const env = {
  port: Number(process.env.PORT ?? 3001),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: process.env.DATABASE_URL ?? "postgres://vms:vms@localhost:5432/vms",
};
