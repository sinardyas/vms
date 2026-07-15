/**
 * Master-data framework — the stack-neutral half (M2.1, #32).
 *
 * The reusable seam every M2 master-list CRUD inherits, so bilingual labels + soft-delete referential
 * integrity are shared, not re-implemented per list. Bilingual-label rendering + validation live in
 * `./label`; the deactivate-hides-from-new-captures contract lives in `./reference`. The API half (the
 * generic RBAC-guarded, audited CRUD route + Drizzle store) is in `@vms/api` (`master-list.ts`).
 */

export * from "./label";
export * from "./reference";
