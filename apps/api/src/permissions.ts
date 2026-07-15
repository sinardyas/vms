/**
 * Actor permission loading (M1.1, #20, ADR-0011/0012).
 *
 * Expands a user's role grants into the stack-neutral {@link PermissionSet} the domain's `can()` and
 * the guard read. Joins `user_roles → role_permissions` (only through **active** roles), turning each
 * `role_permissions` row's five boolean verb columns into `(module, verb)` grants. A user with no
 * roles — or whose roles grant nothing — resolves to the empty set, i.e. deny-all (deny-by-default).
 *
 * The grant *data* is seeded in M1.2 (#21); this is the read the session-backed resolver runs per
 * request. Kept as a pure `(db, userId) → PermissionSet` function so it is unit-testable without auth.
 */

import { type DB, rolePermissions, roles, userRoles } from "@vms/db";
import {
  type Permission,
  type PermissionSet,
  RBAC_VERBS,
  type RbacModule,
  type RbacVerb,
  toPermissionSet,
} from "@vms/domain";
import { and, eq } from "drizzle-orm";

/** Maps a `role_permissions` row's boolean columns to the verb each one grants. */
const VERB_COLUMN: Record<RbacVerb, "canAdd" | "canEdit" | "canDelete" | "canView" | "canApprove"> =
  {
    add: "canAdd",
    edit: "canEdit",
    delete: "canDelete",
    view: "canView",
    approve: "canApprove",
  };

/** One `role_permissions` row projected to the columns the expansion needs. */
export type GrantRow = { module: RbacModule } & Record<(typeof VERB_COLUMN)[RbacVerb], boolean>;

/**
 * Expand `role_permissions` rows into a {@link PermissionSet}: each true verb column becomes a
 * `(module, verb)` grant, and grants union across rows (the set dedupes overlapping roles). Pure and
 * DB-free so the mapping — the RBAC-shaped business rule — is unit-testable in isolation.
 */
export const expandGrants = (rows: readonly GrantRow[]): PermissionSet => {
  const grants: Permission[] = [];
  for (const row of rows) {
    for (const verb of RBAC_VERBS) {
      if (row[VERB_COLUMN[verb]]) grants.push({ module: row.module, verb });
    }
  }
  return toPermissionSet(grants);
};

/**
 * Load the effective {@link PermissionSet} for `userId` from their active roles. Grants from multiple
 * roles union (the set dedupes), so overlapping roles never double-count. A user with no roles — or
 * whose roles grant nothing — resolves to the empty set, i.e. deny-all (deny-by-default).
 */
export const loadPermissions = async (db: DB, userId: string): Promise<PermissionSet> => {
  const rows = await db
    .select({
      module: rolePermissions.module,
      canAdd: rolePermissions.canAdd,
      canEdit: rolePermissions.canEdit,
      canDelete: rolePermissions.canDelete,
      canView: rolePermissions.canView,
      canApprove: rolePermissions.canApprove,
    })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .where(and(eq(userRoles.userId, userId), eq(roles.active, true)));

  return expandGrants(rows);
};
