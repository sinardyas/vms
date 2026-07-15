/**
 * Access-admin domain logic (M1.5, #24, ADR-0011/0012) — the pure, DB-free core of the console
 * Access screen: the RBAC matrix shape, its conversions to/from `role_permissions` rows, the request
 * schemas, and the **deadlock guard** computation.
 *
 * Kept separate from the route (`access-route.ts`) and its Drizzle store so the business rules — how a
 * 9×5 matrix maps to grant rows, and when a save would strand a required approval permission — are
 * unit-testable without Postgres or better-auth. The route orchestrates; this module decides.
 */

import {
  type Permission,
  RBAC_MODULES,
  RBAC_VERBS,
  type RbacModule,
  type RbacVerb,
  emailSchema,
  nonEmptyString,
  permissionKey,
  uuidSchema,
} from "@vms/domain";
import { z } from "zod";

/** The full 9×5 permission grid the matrix editor edits — every module, every verb, on or off. */
export type MatrixGrid = Record<RbacModule, Record<RbacVerb, boolean>>;

/** A grant-less grid (deny-by-default everywhere) — the starting point for a new role. */
export const emptyMatrix = (): MatrixGrid => {
  const grid = {} as MatrixGrid;
  for (const module of RBAC_MODULES) {
    const verbs = {} as Record<RbacVerb, boolean>;
    for (const verb of RBAC_VERBS) verbs[verb] = false;
    grid[module] = verbs;
  }
  return grid;
};

/** One `role_permissions` row shape (the five boolean verb columns) — matches `@vms/db`'s table. */
export type MatrixRow = {
  module: RbacModule;
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canView: boolean;
  canApprove: boolean;
};

/** Project a matrix to one `role_permissions` row per module (all nine, so a cleared row upserts off). */
export const matrixToRows = (matrix: MatrixGrid): MatrixRow[] =>
  RBAC_MODULES.map((module) => ({
    module,
    canAdd: matrix[module].add,
    canEdit: matrix[module].edit,
    canDelete: matrix[module].delete,
    canView: matrix[module].view,
    canApprove: matrix[module].approve,
  }));

/** Rebuild a full grid from stored rows — modules with no row default to all-false (deny-by-default). */
export const matrixFromRows = (rows: readonly MatrixRow[]): MatrixGrid => {
  const grid = emptyMatrix();
  for (const row of rows) {
    if (!RBAC_MODULES.includes(row.module)) continue;
    grid[row.module] = {
      add: row.canAdd,
      edit: row.canEdit,
      delete: row.canDelete,
      view: row.canView,
      approve: row.canApprove,
    };
  }
  return grid;
};

/**
 * The approval permissions the Phase-0 workflow can't run without — the deciders ADR-0009 seeds and
 * ADR-0011's deadlock guard protects: acting on an approval step (`approvals:approve`) and confirming
 * a document at the verification gate (`documents:approve`). If a save strands either with zero active
 * holders, no seeded route could ever be approved. M1.6 refines "eligible" by subtracting SoD; M1.5
 * guards the coarser "does anyone at all still hold it" — enough to catch a matrix edit that deadlocks.
 */
export const CRITICAL_CAPABILITIES: readonly Permission[] = [
  { module: "approvals", verb: "approve" },
  { module: "documents", verb: "approve" },
] as const;

/**
 * The capabilities a change would **strand** — held by at least one active user before, by none after.
 * A *delta* check, deliberately: warning whenever the absolute after-count is zero would nag through
 * the whole greenfield setup (roles are seeded before any user is assigned, so every critical
 * capability starts at zero holders). The real risk ADR-0011 names is *removing the last approver*, so
 * we warn exactly when a save takes a capability from ≥1 holders to 0 — not when it was already empty.
 *
 * `before` / `after` are holder counts keyed by `permissionKey`; the route captures `before` at the
 * top of its transaction and `after` once the change is applied, then this decides the warning.
 */
export const strandedCapabilities = (
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
): Permission[] =>
  CRITICAL_CAPABILITIES.filter((cap) => {
    const key = permissionKey(cap.module, cap.verb);
    return (before[key] ?? 0) >= 1 && (after[key] ?? 0) === 0;
  });

/** Render a capability list as the `{capabilities}` param for the deadlock warning message. */
export const formatCapabilities = (caps: readonly Permission[]): string =>
  caps.map((c) => permissionKey(c.module, c.verb)).join(", ");

// --- Request schemas -----------------------------------------------------------------------------
// Validated at the edge with the domain's Zod primitives; the route turns a parse failure into a
// localized `validationError` via the shared bridge, never a thrown string.

const verbGrid = z.object({
  add: z.boolean(),
  edit: z.boolean(),
  delete: z.boolean(),
  view: z.boolean(),
  approve: z.boolean(),
});

/** A full 9×5 matrix: every module present, every verb a boolean. Rejects unknown/missing modules. */
export const matrixSchema = z.object(
  Object.fromEntries(RBAC_MODULES.map((m) => [m, verbGrid])) as Record<RbacModule, typeof verbGrid>,
) as z.ZodType<MatrixGrid>;

/** A language-neutral role code (ADR-0011): lower snake/kebab, stable, the upsert + join key. */
const roleCode = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/, "code must be lower-case, starting with a letter");

export const createRoleSchema = z.object({
  code: roleCode,
  nameId: nonEmptyString.max(160),
  nameEn: nonEmptyString.max(160),
  leadUserId: uuidSchema.nullish(),
  matrix: matrixSchema,
  confirm: z.boolean().optional(),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  nameId: nonEmptyString.max(160).optional(),
  nameEn: nonEmptyString.max(160).optional(),
  leadUserId: uuidSchema.nullish(),
  active: z.boolean().optional(),
  matrix: matrixSchema.optional(),
  confirm: z.boolean().optional(),
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const createUserSchema = z.object({
  email: emailSchema,
  name: nonEmptyString.max(200),
  roleIds: z.array(uuidSchema).optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  name: nonEmptyString.max(200).optional(),
  active: z.boolean().optional(),
  roleIds: z.array(uuidSchema).optional(),
  confirm: z.boolean().optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// --- DTOs (the JSON the console reads) -----------------------------------------------------------

export type RoleDTO = {
  readonly id: string;
  readonly code: string;
  readonly nameId: string;
  readonly nameEn: string;
  readonly active: boolean;
  readonly leadUserId: string | null;
  readonly userCount: number;
  readonly matrix: MatrixGrid;
};

export type UserRoleRef = {
  readonly id: string;
  readonly code: string;
  readonly nameId: string;
  readonly nameEn: string;
};

export type UserDTO = {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly kind: "vendor" | "internal";
  readonly active: boolean;
  readonly roles: readonly UserRoleRef[];
};

/** One critical approval capability and how many active users currently hold it (for the UI). */
export type CriticalHolders = {
  readonly module: RbacModule;
  readonly verb: RbacVerb;
  readonly holders: number;
};
