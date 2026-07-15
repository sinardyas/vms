/**
 * Seed entrypoint (run inside the Docker `migrate` service after migrations — ticket #3).
 *
 * Seeds the **access-control grant data** (M1.2, #21): the domain-model role set + its
 * `role_permissions` grid, so a resolved session actor stops falling through to the empty
 * (deny-all) set (see #20). Idempotent — safe to re-run on every `docker compose up`.
 *
 * Still to come (fog → later tickets): the UAT accounts + `user_roles` + `roles.lead_user_id`
 * wiring, master-data lists (M2), and the rich vendor scenario loader (M2/M3). Those build on
 * `seedAccess()` rather than replacing it.
 *
 * Run: `bun run src/seed.ts` (script: `bun run seed`).
 */
import { db } from "./index";
import { seedAccess } from "./seed/access";
import { seedRegistrationLists } from "./seed/registration-lists";

async function main() {
  const access = await seedAccess(db);
  // biome-ignore lint/suspicious/noConsole: seed progress belongs in stdout for container logs.
  console.log(
    `[seed] access control: ${access.roles} roles, ${access.permissions} permission rows (idempotent).`,
  );

  const lists = await seedRegistrationLists(db);
  // biome-ignore lint/suspicious/noConsole: seed progress belongs in stdout for container logs.
  console.log(
    `[seed] registration lists: ${lists.countries} countries, ${lists.currencies} currencies, ` +
      `${lists.banks} banks, ${lists.businessEntities} business entities, ` +
      `${lists.vendorCategories} vendor categories (idempotent).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    // biome-ignore lint/suspicious/noConsole: surface seed failures to container logs.
    console.error("[seed] failed:", error);
    process.exit(1);
  });
