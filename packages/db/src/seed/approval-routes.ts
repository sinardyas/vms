/**
 * Approval-routes seed (M2.4, #35, ADR-0009) — the trigger→ordered-steps routing table the M4 workflow
 * engine resolves, loaded so a fresh `docker compose up` lands testers on the five 2-step routes the
 * design fixed. One route per `approval_trigger`, each step naming the deciding role (ADR-0009 table):
 *
 *   | Trigger                     | Step 1     | Step 2                             |
 *   |-----------------------------|------------|------------------------------------|
 *   | new_vendor_registration     | AP Staff   | AP Supervisor / Asst. Manager      |
 *   | office_vendor_registration  | HOD        | —                                  |
 *   | bank_change                 | AP Staff   | AP Manager                         |
 *   | non_bank_change             | AP Staff   | AP Supervisor / Asst. Manager      |
 *   | reactivation                | AP Manager | —                                  |
 *
 * **No blacklist route** — violations/blacklist is out of Phase-0 scope (drift audit #4). Steps
 * reference roles by their language-neutral `code` (#21's `seedAccess`), so this must run **after**
 * `seedAccess` (the roles must exist). Bypassing the console's deadlock guard is deliberate: seeds run
 * before any user is assigned, so every role has zero holders — the guard is for interactive edits.
 *
 * Idempotent (re-runnable on every boot): routes upsert on their unique `trigger`; steps upsert on the
 * `(route_id, step_no)` unique index (so step ids stay stable across re-seeds). Re-seeding sets the
 * route `active` back to true — the "seed activates every row it references" rule (seed-matrix §0).
 */

import { eq } from "drizzle-orm";
import type { DB } from "../index";
import { approvalRouteSteps, approvalRoutes } from "../schema/master-data";
import { roles } from "../schema/rbac";

/** One seed route: its trigger (the unique routing key), bilingual name, and ordered step role codes. */
export type ApprovalRouteSeed = {
  readonly trigger: string;
  readonly nameId: string;
  readonly nameEn: string;
  readonly steps: readonly string[]; // role codes, in decision order (step 1, step 2, …)
};

/** The five ADR-0009 routes. Role codes match `seedAccess` (#21): ap_staff, ap_supervisor, ap_manager, hod. */
export const APPROVAL_ROUTE_SEED: readonly ApprovalRouteSeed[] = [
  {
    trigger: "new_vendor_registration",
    nameId: "Pendaftaran Vendor Baru (Mandiri)",
    nameEn: "New Vendor Registration (Self)",
    steps: ["ap_staff", "ap_supervisor"],
  },
  {
    trigger: "office_vendor_registration",
    nameId: "Pendaftaran Vendor oleh Kantor",
    nameEn: "Office Vendor Registration",
    steps: ["hod"],
  },
  {
    trigger: "bank_change",
    nameId: "Perubahan Bank",
    nameEn: "Bank Change",
    steps: ["ap_staff", "ap_manager"],
  },
  {
    trigger: "non_bank_change",
    nameId: "Perubahan Data Non-Bank",
    nameEn: "Non-Bank Change",
    steps: ["ap_staff", "ap_supervisor"],
  },
  {
    trigger: "reactivation",
    nameId: "Reaktivasi Vendor",
    nameEn: "Vendor Reactivation",
    steps: ["ap_manager"],
  },
];

/** Fail loudly on a malformed seed (blank label / no steps) — a data bug, not a runtime condition. */
const assertRouteSeedConsistent = (): void => {
  const triggers = new Set<string>();
  for (const r of APPROVAL_ROUTE_SEED) {
    if (triggers.has(r.trigger)) throw new Error(`[seed] duplicate route trigger: ${r.trigger}`);
    triggers.add(r.trigger);
    if (!r.nameId.trim() || !r.nameEn.trim())
      throw new Error(`[seed] approval route has a blank label: ${r.trigger}`);
    if (r.steps.length === 0) throw new Error(`[seed] approval route has no steps: ${r.trigger}`);
  }
};

/**
 * Seed (or re-seed) the ADR-0009 approval routes + their ordered steps. Idempotent — routes upsert on
 * `trigger`, steps on `(route_id, step_no)`. Must run after `seedAccess` (steps resolve role codes).
 * Returns row counts for the container log.
 */
export const seedApprovalRoutes = async (
  db: DB,
): Promise<{ routes: number; steps: number }> => {
  assertRouteSeedConsistent();

  // Resolve the seeded role codes to ids once (they exist — seedAccess ran first).
  const roleRows = await db.select({ id: roles.id, code: roles.code }).from(roles);
  const roleIdByCode = new Map(roleRows.map((r) => [r.code, r.id]));

  let stepCount = 0;
  for (const route of APPROVAL_ROUTE_SEED) {
    const [row] = await db
      .insert(approvalRoutes)
      .values({ trigger: route.trigger, nameId: route.nameId, nameEn: route.nameEn })
      .onConflictDoUpdate({
        target: approvalRoutes.trigger,
        set: {
          nameId: route.nameId,
          nameEn: route.nameEn,
          active: true,
          updatedAt: new Date(),
        },
      })
      .returning({ id: approvalRoutes.id });
    if (!row) throw new Error(`[seed] approval route upsert returned no row: ${route.trigger}`);

    for (const [i, code] of route.steps.entries()) {
      const roleId = roleIdByCode.get(code);
      if (!roleId)
        throw new Error(`[seed] approval route ${route.trigger} references unknown role: ${code}`);
      await db
        .insert(approvalRouteSteps)
        .values({ routeId: row.id, stepNo: i + 1, roleId })
        .onConflictDoUpdate({
          target: [approvalRouteSteps.routeId, approvalRouteSteps.stepNo],
          set: { roleId, updatedAt: new Date() },
        });
      stepCount += 1;
    }
  }

  return { routes: APPROVAL_ROUTE_SEED.length, steps: stepCount };
};
