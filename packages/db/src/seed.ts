/**
 * Seed entrypoint. Placeholder plumbing — the Docker substrate wires `migrate + seed`
 * to run inside the stack (ticket #3), but the actual seed *content* lands with later
 * tickets: master-data seeds (M2), RBAC roles/permissions (M1.2), and the rich UAT
 * scenario loader (~8 vendors across all states, pre-seeded accounts). Until then this
 * verifies DB connectivity and exits cleanly so the stack comes up green.
 *
 * Run: `bun run src/seed.ts` (script: `bun run seed`).
 */
import { sql } from "drizzle-orm";
import { db } from "./index";

async function main() {
  // Prove the connection is live; later tickets replace this body with real inserts.
  await db.execute(sql`select 1`);
  // biome-ignore lint/suspicious/noConsole: seed progress belongs in stdout for container logs.
  console.log("[seed] connected — no seed data yet (lands with M1/M2/M3 tickets).");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    // biome-ignore lint/suspicious/noConsole: surface seed failures to container logs.
    console.error("[seed] failed:", error);
    process.exit(1);
  });
