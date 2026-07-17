/**
 * UAT scenario seed entrypoint (#88) — run as the one-shot `seed-scenario` service after `migrate`.
 *
 * Two seeds, two layers. `@vms/db`'s `bun run seed` (the `migrate` service) loads the **reference**
 * data the schema needs to function at all: roles, permission grid, master lists, approval routes.
 * This loads the **scenario** on top: accounts, the vendor roster, the in-flight queues. The split is
 * not bureaucratic — the scenario is domain data, and building it needs better-auth's hasher,
 * `@vms/domain`'s activation-gate composition and the MinIO storage seam, none of which the
 * deliberately domain-free `@vms/db` can reach. See `./seed/scenario.ts` for the full rationale.
 *
 * Run: `bun run src/seed-scenario.ts` (script: `bun run seed:scenario`). Idempotent.
 */

import { env } from "./env";
import { SEED_PASSWORD, STAFF_SEED, UNSEEDED_SIGNUP_EMAIL, VENDOR_SEED } from "./seed/fixtures";
import { seedScenario } from "./seed/scenario";

/**
 * May the scenario load into *this* database?
 *
 * The seed mints accounts that all share one published password and a roster of vendors that do not
 * exist. In dev and UAT that is the entire point; in a real production database it would be a
 * security incident. So production requires someone to say so explicitly — `SEED_SCENARIO=1` — while
 * dev and test stay turnkey.
 *
 * The asymmetry is deliberate, and it is the lesson of #97/#99: a convenience default that is *on*
 * everywhere is exactly how `DEV_ACTOR=1` let the console ship for six milestones with no auth
 * surface — nobody exercised the path the real deployment takes. UAT runs under `NODE_ENV=production`
 * (the staging overlay pins it), so UAT *is* the path that must be opted into, and standing UAT up is
 * a deliberate act with a deliberate flag. A production deployment that simply does not run this
 * service seeds nothing; one that runs it by accident still seeds nothing.
 */
const allowed = env.nodeEnv !== "production" || process.env.SEED_SCENARIO === "1";

/** The UAT login card, printed to the container log so testers can find it without the matrix. */
const logLoginCard = (): void => {
  const lines = [
    "",
    "  ── UAT accounts ──────────────────────────────────────────────",
    `  password (all accounts): ${SEED_PASSWORD}`,
    "",
    "  Console (staff):",
    ...STAFF_SEED.map((s) => `    ${s.email.padEnd(24)} ${s.roleCode}`),
    "",
    "  Portal (vendor owners):",
    ...VENDOR_SEED.map((v) => `    ${v.ownerEmail.padEnd(32)} ${v.name} (${v.status})`),
    "",
    `  Fresh-signup demo (NOT seeded — verify via Mailpit :8025): ${UNSEEDED_SIGNUP_EMAIL}`,
    "  ──────────────────────────────────────────────────────────────",
    "",
  ];
  console.log(lines.join("\n"));
};

async function main() {
  if (!allowed) {
    console.log(
      "[seed-scenario] skipped: NODE_ENV=production without SEED_SCENARIO=1. " +
        "Set SEED_SCENARIO=1 to load the UAT scenario into this database.",
    );
    return;
  }

  const counts = await seedScenario();
  console.log(
    `[seed-scenario] ${counts.accounts} accounts, ${counts.vendors} vendors, ${counts.banks} banks, ${counts.documents} documents, ${counts.filesStored} files, ${counts.requests} in-flight requests (idempotent).`,
  );
  logLoginCard();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[seed-scenario] failed:", error);
    process.exit(1);
  });
