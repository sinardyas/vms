/**
 * Approval-routes domain logic (M2.4, #35, ADR-0009/0011) — the pure, DB-free core of the Approval
 * Routes master: the request schemas, the DTO shapes, and the **deadlock-guard** computation that
 * decides when saving a route's steps would strand it with an un-approvable step.
 *
 * Kept separate from the route (`approval-routes-route.ts`) and its Drizzle store so the one rule with
 * real logic — when a step-list change leaves a step whose role has no eligible approver — is
 * unit-testable without Postgres. The route orchestrates (guards, validation, 422 mapping); this
 * module decides.
 *
 * The routes themselves are the ADR-0009 trigger→ordered-steps table the M4 engine resolves: one route
 * per `approval_trigger`, each step naming the role that decides it (auto-assigned to the role lead,
 * ADR-0012). Eligibility for a step is M1.6's formula (#25) projected to config time: a step's role is
 * *staffable* when at least one active user carrying that role also holds `approvals:approve` — the
 * permission half of `approverIneligibility` (the per-request SoD half applies later, in M4.3). The
 * caller (the store) gathers which roles are staffable; this module does the delta.
 */

import {
  approvalTriggerSchema,
  bilingualLabelFields,
  bilingualLabelPatchFields,
} from "@vms/domain";
import { z } from "zod";
import type { MasterDTO } from "./master-list";

// --- DTOs (the JSON the console reads) -----------------------------------------------------------

/** An approval route header — one per trigger, bilingual name, soft-enable flag. */
export type ApprovalRouteDTO = MasterDTO & {
  readonly trigger: string;
  readonly nameId: string;
  readonly nameEn: string;
};

/** One ordered step of a route: its position and the role that decides it (joined for display). */
export type RouteStepDTO = {
  readonly id: string;
  readonly routeId: string;
  readonly stepNo: number;
  readonly roleId: string;
  readonly roleCode: string;
  readonly roleNameId: string;
  readonly roleNameEn: string;
};

/** A role the step editor can pick — the active roles, for the approver-role dropdown. */
export type RolePickDTO = {
  readonly id: string;
  readonly code: string;
  readonly nameId: string;
  readonly nameEn: string;
};

// --- Request schemas -----------------------------------------------------------------------------
// Validated at the edge with the domain's Zod primitives; the route turns a parse failure into a
// localized `validationError` via the shared bridge, never a thrown string.

/**
 * Create a route: its `trigger` (one of the five `approval_trigger` values, unique — 409 on a repeat)
 * and its bilingual name. Steps are set separately via the steps sub-router, so a route is born with a
 * header and gets its ordered roles configured after.
 */
export const createRouteSchema = z.object({
  trigger: approvalTriggerSchema,
  ...bilingualLabelFields(160),
});
export type CreateRouteInput = z.infer<typeof createRouteSchema>;

/** Update a route header — name only. `trigger` is create-only (the unique routing key) like a `code`. */
export const updateRouteSchema = z.object({
  ...bilingualLabelPatchFields(160),
});
export type UpdateRouteInput = z.infer<typeof updateRouteSchema>;

/**
 * Replace a route's steps wholesale (the editor always sends the full ordered list, like the M1.5
 * matrix editor sends the full grid). Each step names the deciding role; `stepNo` is derived from the
 * array order (1-based). `confirm` re-submits past the deadlock guard (ADR-0011b, 422 → confirm:true).
 */
export const replaceStepsSchema = z.object({
  steps: z.array(z.object({ roleId: z.string().uuid() })).min(1),
  confirm: z.boolean().optional(),
});
export type ReplaceStepsInput = z.infer<typeof replaceStepsSchema>;

// --- Deadlock guard (the one bit with real logic) ------------------------------------------------

/**
 * The step roles a save would **strand** — leave the route with a step whose role has no eligible
 * approver, where the route was fully staffable before.
 *
 * A *delta* guard, deliberately mirroring M1.5's (#24): a route is only "stranded" if it *was* sound
 * (every current step role staffable) and the save makes it unsound. Warning whenever any after-role
 * is unstaffable would nag through the whole greenfield period — routes are seeded (#21 role grants,
 * this ticket's routes) long before any user is assigned, so every role starts with zero holders and
 * every route is un-staffable by definition. So we warn exactly when a save takes a *working* route
 * (all roles covered) to a broken one — never when it was already broken, and never on the empty
 * before-state of a brand-new route (nothing to strand yet).
 *
 * `beforeRoleIds` / `afterRoleIds` are the route's step roles before and after the save (user→role
 * assignments don't change mid-save, so `eligibleRoleIds` is one snapshot of which roles are staffable
 * right now). Returns the distinct after-roles that are unstaffable, or `[]` if the save is safe.
 */
export const strandedStepRoles = (
  beforeRoleIds: readonly string[],
  afterRoleIds: readonly string[],
  eligibleRoleIds: ReadonlySet<string>,
): string[] => {
  // A route with no prior steps was never executable — replacing an empty step-list can't strand it.
  const wasSound =
    beforeRoleIds.length > 0 && beforeRoleIds.every((roleId) => eligibleRoleIds.has(roleId));
  if (!wasSound) return [];
  const stranded = afterRoleIds.filter((roleId) => !eligibleRoleIds.has(roleId));
  return [...new Set(stranded)];
};

/** Render a stranded-role list as the `{roles}` param for the deadlock warning (codes, stable order). */
export const formatStrandedRoles = (roles: readonly RolePickDTO[]): string =>
  roles.map((r) => r.code).join(", ");
