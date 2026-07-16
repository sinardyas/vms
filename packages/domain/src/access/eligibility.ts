/**
 * Approver eligibility + separation of duties (M1.6, ADR-0009).
 *
 * The pure primitive the M4 approval engine reuses to decide **who may approve** an
 * ApprovalRequest. Eligibility is the RBAC formula made concrete:
 *
 *     eligible = (role ∩ approve-permission) − SoD
 *
 * The intersection is already resolved on each candidate: an {@link ApproverCandidate}'s
 * {@link PermissionSet} is the union of its roles' grants (M1.1's `loadPermissions` expands
 * `user_roles ⋈ role_permissions`), so holding {@link APPROVE_PERMISSION} *is* "role ∩ approve-perm".
 * This module subtracts the ADR-0009 separation-of-duties exclusions on top:
 *
 *   1. **No self-approval** — the submitter of a request cannot approve it, at any step.
 *   2. **Verifier ≠ approver** — a user who verified any document on the subject vendor cannot
 *      act as an approver on that vendor's registration/edit request.
 *
 * Stack-neutral and side-effect-free — no Drizzle, no Hono. The caller gathers the pool and the
 * SoD facts (submitter, document verifiers) from persistence; this function does the set algebra.
 * M4.3 wires it into the engine (a zero-eligible pool escalates to an admin override) and the API
 * turns a non-null {@link IneligibilityReason} into a 403. M1.5's holder-count guard uses only the
 * permission half — this refines it by also subtracting SoD.
 */

import type { Permission, PermissionSet } from "./rbac";
import { permissionKey } from "./rbac";

/** A user who might approve an ApprovalRequest — identity plus resolved RBAC grants. */
export type ApproverCandidate = {
  readonly userId: string;
  /** Union of the user's roles' grants (M1.1 `loadPermissions`); empty = holds nothing. */
  readonly permissions: PermissionSet;
};

/**
 * The separation-of-duties facts about one ApprovalRequest (ADR-0009). Both fields are optional —
 * a request with no known submitter or no verifications simply applies fewer exclusions.
 */
export type SodContext = {
  /** The user who submitted the request under approval — barred from approving it (no self-approval). */
  readonly submitterUserId?: string | null;
  /** Users who verified any document on the subject vendor — barred from approving (verifier ≠ approver). */
  readonly verifierUserIds?: Iterable<string>;
};

/** Why a candidate is not an eligible approver. `null` from {@link approverIneligibility} = eligible. */
export type IneligibilityReason = "missing-permission" | "self-approval" | "verifier";

/**
 * The default required grant for a registration/edit approval step (ADR-0009). Document-verifier
 * eligibility passes `{ module: "documents", verb: "approve" }` instead — hence `required` is a param.
 */
export const APPROVE_PERMISSION: Permission = { module: "approvals", verb: "approve" };

/**
 * The grant that authorises an **admin override** of a zero-eligible step (M4.3, ADR-0014). When SoD +
 * permissions leave a step with no eligible approver, the request must not silently stall — a holder of
 * this grant may approve it as an override (audited, `is_override`). It is `approvals:edit` — "administer
 * the approval workflow", distinct from `approvals:approve` ("decide a step you are eligible for") — which
 * in the seeded grid only the System Administrator holds (the four approver roles hold `view`+`approve`
 * only). Reusing an existing verb keeps override authority in the RBAC vocabulary with no new enum.
 */
export const OVERRIDE_PERMISSION: Permission = { module: "approvals", verb: "edit" };

/** Whether `candidate` may perform an admin override — holds {@link OVERRIDE_PERMISSION} (M4.3, ADR-0014). */
export const hasOverrideAuthority = (candidate: ApproverCandidate): boolean =>
  candidate.permissions.has(permissionKey(OVERRIDE_PERMISSION.module, OVERRIDE_PERMISSION.verb));

/**
 * Why `candidate` cannot approve under `sod`, or `null` if eligible. Checks the RBAC intersection
 * first (missing the `required` grant → `"missing-permission"`), then subtracts SoD in ADR-0009
 * order: submitter (`"self-approval"`) before document verifier (`"verifier"`).
 */
export const approverIneligibility = (
  candidate: ApproverCandidate,
  sod: SodContext,
  required: Permission = APPROVE_PERMISSION,
): IneligibilityReason | null => {
  if (!candidate.permissions.has(permissionKey(required.module, required.verb))) {
    return "missing-permission";
  }
  if (sod.submitterUserId != null && candidate.userId === sod.submitterUserId) {
    return "self-approval";
  }
  if (sod.verifierUserIds) {
    for (const verifierId of sod.verifierUserIds) {
      if (verifierId === candidate.userId) return "verifier";
    }
  }
  return null;
};

/** Whether `candidate` may approve under `sod` — the boolean form of {@link approverIneligibility}. */
export const isEligibleApprover = (
  candidate: ApproverCandidate,
  sod: SodContext,
  required: Permission = APPROVE_PERMISSION,
): boolean => approverIneligibility(candidate, sod, required) === null;

/** The eligible subset of `candidates` under `sod` — `role ∩ approve-permission − SoD`. */
export const eligibleApprovers = <T extends ApproverCandidate>(
  candidates: readonly T[],
  sod: SodContext,
  required: Permission = APPROVE_PERMISSION,
): T[] => candidates.filter((candidate) => isEligibleApprover(candidate, sod, required));

/**
 * Whether any candidate is eligible. `false` means the engine must escalate to an admin override
 * (M4.3, ADR-0014) — short-circuits, so cheaper than `eligibleApprovers(...).length > 0`.
 */
export const hasEligibleApprover = (
  candidates: readonly ApproverCandidate[],
  sod: SodContext,
  required: Permission = APPROVE_PERMISSION,
): boolean => candidates.some((candidate) => isEligibleApprover(candidate, sod, required));
