/**
 * RBAC permission model + capability contract (M0.4, ADR-0011, 0012).
 *
 * Stack-neutral seam shared by the API guard and both UIs: the server enforces a permission
 * and the screen shows only the affordances the same permission allows, so the two can never
 * drift. Deny-by-default — an actor holds a grant only if its resolved {@link PermissionSet}
 * contains the `(module, verb)` pair.
 *
 * The permission *data* (which role grants what) lives in `role_permissions` (`@vms/db`) and is
 * loaded per-actor in M1; this module is the shape + evaluator that M1 fills, not the enforcement.
 * The `can()` check itself lives beside {@link Actor} in `./actor` (it reads the actor's set).
 */

import { RBAC_MODULES, RBAC_VERBS, type RbacModule, type RbacVerb } from "../values/enums";

/** A single grant: the actor may perform `verb` on `module`. */
export type Permission = { readonly module: RbacModule; readonly verb: RbacVerb };

/** Canonical `module:verb` string — the identity used for set membership and lookup. */
export const permissionKey = (module: RbacModule, verb: RbacVerb): string => `${module}:${verb}`;

/** An actor's resolved grants, as a set of {@link permissionKey}s. Empty = holds nothing. */
export type PermissionSet = ReadonlySet<string>;

/** The empty set — deny everything. The safe default for an actor whose grants aren't resolved. */
export const NO_PERMISSIONS: PermissionSet = new Set<string>();

/** Build a {@link PermissionSet} from grant rows (e.g. `role_permissions` expanded to pairs). */
export const toPermissionSet = (grants: Iterable<Permission>): PermissionSet => {
  const set = new Set<string>();
  for (const grant of grants) set.add(permissionKey(grant.module, grant.verb));
  return set;
};

/** UI capability contract: `module → verb → allowed`. What a screen reads to show/hide actions. */
export type CapabilityFlags = Record<RbacModule, Record<RbacVerb, boolean>>;

/** Expand a {@link PermissionSet} into the full module×verb map the UI consumes (all 9×5 flags). */
export const capabilities = (permissions: PermissionSet): CapabilityFlags => {
  const flags = {} as Record<RbacModule, Record<RbacVerb, boolean>>;
  for (const module of RBAC_MODULES) {
    const verbs = {} as Record<RbacVerb, boolean>;
    for (const verb of RBAC_VERBS) verbs[verb] = permissions.has(permissionKey(module, verb));
    flags[module] = verbs;
  }
  return flags;
};
