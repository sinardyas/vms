/**
 * Access-control seed (M1.2, #21) — the domain-model role set + its permission grid.
 *
 * This is the *grant data* the RBAC stack reads: the M1.1 session resolver expands a user's active
 * roles (`user_roles ⋈ role_permissions`) into a `PermissionSet` (`apps/api` `loadPermissions`), and
 * `can(actor, module, verb)` reads that set deny-by-default. Until these rows exist a valid session
 * resolves to the empty (deny-all) set (see #20) — so this seed is what makes actors non-grant-less.
 *
 * Scope boundary: this seeds `roles` + `role_permissions` only. Users, `user_roles`, and each role's
 * `lead_user_id` (ADR-0012 auto-dispatch) are wired by the UAT account loader (M2/M3) once accounts
 * exist — `seedAccess()` is exported so that loader builds on it rather than duplicating the grid.
 *
 * Idempotent: roles upsert on `code` (the language-neutral key, ADR-0011), permissions upsert on the
 * `(role, module)` unique index — safe to re-run on every `docker compose up`.
 *
 * Consistency: the grid satisfies the ADR-0011 **deadlock guard** — every role that decides a seeded
 * approval-route step (ADR-0009) holds the matching `approve` permission, so no seeded route can have
 * zero eligible approvers. Row-level scoping (a Vendor only sees its own vendor) is M1.3 enforcement,
 * not a module grant, so it is intentionally absent here.
 */

import type { DB } from "../index";
import { rbacModuleEnum } from "../schema/enums";
import { rolePermissions, roles } from "../schema/rbac";

/** A permission subject — one of the nine `rbac_module` enum values (ADR-0012). */
export type Module = (typeof rbacModuleEnum.enumValues)[number];
/** A permission verb (ADR-0011). Mirrors `role_permissions`'s five boolean columns. */
export type Verb = "add" | "edit" | "delete" | "view" | "approve";

/** All five verbs, for roles that hold a subject fully (e.g. the administrator). */
const ALL_VERBS = ["add", "edit", "delete", "view", "approve"] as const satisfies readonly Verb[];

/** A role and the grants it holds — the seed's source of truth. */
export type RoleSeed = {
  /** Language-neutral stable key (ADR-0011); the upsert and approval-route seeds join on it. */
  readonly code: string;
  readonly nameId: string;
  readonly nameEn: string;
  /** Module → verbs granted. A module absent from the map grants nothing (deny-by-default). */
  readonly grants: Partial<Record<Module, readonly Verb[]>>;
};

/** Every module → every verb — the administrator holds the whole matrix. */
const FULL_GRID = Object.fromEntries(
  rbacModuleEnum.enumValues.map((m) => [m, ALL_VERBS]),
) as unknown as Record<Module, readonly Verb[]>;

/**
 * The domain-model actor set (seed-matrix #10 SEED-2). Six staff roles + the vendor owner. Each grid
 * grants only what the actor's job needs; approver roles carry `approvals.approve` (or, for the
 * verifier, `documents.approve`) so the seeded routes never deadlock (ADR-0011).
 */
export const ROLE_SEED: readonly RoleSeed[] = [
  {
    code: "system_administrator",
    nameId: "Administrator Sistem",
    nameEn: "System Administrator",
    // Master-data + Access (RBAC) administration; sees and manages everything.
    grants: FULL_GRID,
  },
  {
    code: "ap_staff",
    nameId: "Staf AP",
    nameEn: "AP Staff",
    // Raises office registrations; step-1 approver on `new_vendor_registration`.
    grants: {
      vendors: ["add", "edit", "view"],
      documents: ["add", "view"],
      approvals: ["view", "approve"],
      registration_lists: ["view"],
      operational_lists: ["view"],
      audit: ["view"],
    },
  },
  {
    code: "ap_supervisor",
    nameId: "Supervisor AP / Asisten Manajer",
    nameEn: "AP Supervisor / Asst. Manager",
    // Step-2 approver on `new_vendor_registration` and `non_bank_change`.
    grants: {
      vendors: ["edit", "view"],
      documents: ["view"],
      approvals: ["view", "approve"],
      registration_lists: ["view"],
      operational_lists: ["view"],
      audit: ["view"],
    },
  },
  {
    code: "ap_manager",
    nameId: "Manajer AP",
    nameEn: "AP Manager",
    // Approves `bank_change` and `reactivation`.
    grants: {
      vendors: ["edit", "view"],
      documents: ["view"],
      approvals: ["view", "approve"],
      registration_lists: ["view"],
      operational_lists: ["view"],
      audit: ["view"],
    },
  },
  {
    code: "hod",
    nameId: "Kepala Departemen",
    nameEn: "Head of Department",
    // Activates office registrations (`office_vendor_registration` → HOD, single step).
    grants: {
      vendors: ["edit", "view"],
      documents: ["view"],
      approvals: ["view", "approve"],
      registration_lists: ["view"],
      operational_lists: ["view"],
      audit: ["view"],
    },
  },
  {
    code: "document_verifier",
    nameId: "Verifikator Dokumen",
    nameEn: "Document Verifier",
    // Works the doc-verification queue; verify ≈ the Documents `approve` permission (ADR-0011/0012).
    grants: {
      vendors: ["view"],
      documents: ["view", "approve"],
      registration_lists: ["view"],
      operational_lists: ["view"],
      audit: ["view"],
    },
  },
  {
    code: "vendor",
    nameId: "Vendor",
    nameEn: "Vendor",
    // The vendor owner (portal). Manages their own vendor record + documents; reads registration
    // lists (categories/banks/entities) to fill the form. Own-vendor scoping is M1.3 enforcement.
    grants: {
      vendors: ["add", "edit", "view"],
      documents: ["add", "edit", "view"],
      registration_lists: ["view"],
    },
  },
] as const;

/**
 * Static invariants over {@link ROLE_SEED}, checked before any write so a malformed grid fails the
 * seed loudly instead of silently shipping a deadlocked or grant-less role. Returns nothing; throws
 * on violation. Also unit-tested in `access.test.ts` so CI catches regressions without a DB.
 */
export const assertRoleSeedConsistent = (rows: readonly RoleSeed[] = ROLE_SEED): void => {
  const codes = new Set<string>();
  for (const role of rows) {
    if (codes.has(role.code)) throw new Error(`[seed] duplicate role code: ${role.code}`);
    codes.add(role.code);

    const modules = Object.keys(role.grants) as Module[];
    // DoD (#21): no role is grant-less — every role holds at least one (module, verb).
    const grantCount = modules.reduce((n, m) => n + (role.grants[m]?.length ?? 0), 0);
    if (grantCount === 0) throw new Error(`[seed] role "${role.code}" is grant-less`);

    for (const module of modules) {
      if (!rbacModuleEnum.enumValues.includes(module))
        throw new Error(`[seed] role "${role.code}" grants unknown module: ${module}`);
      for (const verb of role.grants[module] ?? []) {
        if (!ALL_VERBS.includes(verb))
          throw new Error(`[seed] role "${role.code}" grants unknown verb: ${verb}`);
      }
    }
  }

  // ADR-0011 deadlock guard: every role that decides a seeded approval-route step must hold the
  // matching approve permission, or that route would have zero eligible approvers.
  const holds = (code: string, module: Module, verb: Verb): boolean =>
    rows.find((r) => r.code === code)?.grants[module]?.includes(verb) ?? false;
  const approverRoles = ["ap_staff", "ap_supervisor", "ap_manager", "hod"] as const;
  for (const code of approverRoles) {
    if (!holds(code, "approvals", "approve"))
      throw new Error(`[seed] deadlock guard: role "${code}" lacks approvals:approve`);
  }
  if (!holds("document_verifier", "documents", "approve"))
    throw new Error(`[seed] deadlock guard: role "document_verifier" lacks documents:approve`);
};

/**
 * Seed (or re-seed) the role set and its permission grid. Idempotent: roles upsert on `code`,
 * permissions upsert on the `(role, module)` unique index. Users, `user_roles`, and `lead_user_id`
 * are the account loader's job (M2/M3) — this deliberately touches only `roles` + `role_permissions`.
 * Returns the number of roles and permission rows written, for the seed log.
 */
export const seedAccess = async (db: DB): Promise<{ roles: number; permissions: number }> => {
  assertRoleSeedConsistent();

  let permissionCount = 0;
  for (const role of ROLE_SEED) {
    const [row] = await db
      .insert(roles)
      .values({ code: role.code, nameId: role.nameId, nameEn: role.nameEn })
      .onConflictDoUpdate({
        target: roles.code,
        set: { nameId: role.nameId, nameEn: role.nameEn, active: true, updatedAt: new Date() },
      })
      .returning({ id: roles.id });
    if (!row) throw new Error(`[seed] failed to upsert role "${role.code}"`);

    for (const module of Object.keys(role.grants) as Module[]) {
      const verbs = new Set(role.grants[module]);
      const grant = {
        roleId: row.id,
        module,
        canAdd: verbs.has("add"),
        canEdit: verbs.has("edit"),
        canDelete: verbs.has("delete"),
        canView: verbs.has("view"),
        canApprove: verbs.has("approve"),
      };
      await db
        .insert(rolePermissions)
        .values(grant)
        .onConflictDoUpdate({
          target: [rolePermissions.roleId, rolePermissions.module],
          set: {
            canAdd: grant.canAdd,
            canEdit: grant.canEdit,
            canDelete: grant.canDelete,
            canView: grant.canView,
            canApprove: grant.canApprove,
          },
        });
      permissionCount += 1;
    }
  }

  return { roles: ROLE_SEED.length, permissions: permissionCount };
};
