/**
 * Console → approval-engine API client (M4.6, #61).
 *
 * Typed wrappers over `/console/approvals` (M4.2, #57) — the queue (my-queue `?mine`, role-queue `?role`,
 * all-open), a request's detail (subject + ordered route steps + the proposed diff for a post-activation
 * edit), the decide actions (approve / reject-with-reason), and reassign/delegate (with its candidate
 * pool). Plus the two change-request reads the vendor profile's pending-change banner needs (M4.5, #60):
 * `current` (the open edit + its diff) and `cancel` (the submitter withdraws it pre-decision).
 *
 * DTO shapes mirror `apps/api` (the console can't import across the app boundary). Every call rides
 * {@link request} (session cookie + `?lang`), so a guard refusal or a 409 comes back localized + typed.
 */

import type { VendorChangeInput } from "@vms/domain";
import { type VendorApiError, request } from "./vendors";

export type { VendorApiError };

/* ── DTOs (mirror the API) ────────────────────────────────────────────────────────────────────── */

/** One step of a request's route, with its role, assignee, and recorded decision. */
export type ApprovalStepDTO = {
  stepNo: number;
  roleId: string;
  roleCode: string;
  roleNameId: string;
  roleNameEn: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  decision: "pending" | "approved" | "rejected";
  decidedBy: string | null;
  decidedByName: string | null;
  reason: string | null;
  decidedAt: string | null;
  isOverride: boolean;
};

/** A request as the queue lists it. */
export type ApprovalRequestSummaryDTO = {
  id: string;
  subjectVendorId: string;
  vendorName: string;
  trigger: string;
  status: string;
  currentStepNo: number;
  currentStepRoleId: string | null;
  currentStepRoleCode: string | null;
  currentStepRoleNameId: string | null;
  currentStepRoleNameEn: string | null;
  currentAssigneeUserId: string | null;
  currentAssigneeName: string | null;
  submittedBy: string | null;
  createdAt: string;
};

/** A request opened in detail — the summary, its ordered steps, and (for an edit) the proposed diff. */
export type ApprovalRequestDetailDTO = ApprovalRequestSummaryDTO & {
  routeId: string;
  resolvedAt: string | null;
  payload: VendorChangeInput | null;
  steps: ApprovalStepDTO[];
};

/** A user the delegate/reassign picker offers (holds the step's role). */
export type AssigneeCandidateDTO = { userId: string; name: string; email: string };

/** Which queue to show — assigned to me, routed to a role I hold, or every open request. */
export type QueueScope = "mine" | "role" | "all";

/* ── Client ───────────────────────────────────────────────────────────────────────────────────── */

const scopeQuery = (scope: QueueScope): string =>
  scope === "mine" ? "?mine=1" : scope === "role" ? "?role=1" : "";

export const approvalsApi = {
  /** Open requests in the chosen queue (my / role / all). */
  list: (locale: string, scope: QueueScope): Promise<ApprovalRequestSummaryDTO[]> =>
    request<{ items: ApprovalRequestSummaryDTO[] }>(
      `/console/approvals${scopeQuery(scope)}`,
      locale,
    ).then((r) => r.items),

  /** One request's full detail (subject + steps + diff). */
  get: (locale: string, id: string): Promise<ApprovalRequestDetailDTO> =>
    request<{ item: ApprovalRequestDetailDTO }>(`/console/approvals/${id}`, locale).then(
      (r) => r.item,
    ),

  /** The active users who hold a step's role — the reassign/delegate pool. */
  candidates: (locale: string, id: string, stepNo: number): Promise<AssigneeCandidateDTO[]> =>
    request<{ items: AssigneeCandidateDTO[] }>(
      `/console/approvals/${id}/steps/${stepNo}/candidates`,
      locale,
    ).then((r) => r.items),

  /** Approve the current step (advance, or on the final step resolve + apply the subject effect). */
  approve: (locale: string, id: string, note?: string): Promise<ApprovalRequestDetailDTO> =>
    request<{ item: ApprovalRequestDetailDTO }>(`/console/approvals/${id}/approve`, locale, {
      method: "POST",
      body: JSON.stringify(note ? { reason: note } : {}),
    }).then((r) => r.item),

  /** Reject the request with a required reason → resolves rejected + returns the subject to Draft. */
  reject: (locale: string, id: string, reason: string): Promise<ApprovalRequestDetailDTO> =>
    request<{ item: ApprovalRequestDetailDTO }>(`/console/approvals/${id}/reject`, locale, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }).then((r) => r.item),

  /** Reassign/delegate the current open step to another eligible user. */
  reassign: (
    locale: string,
    id: string,
    stepNo: number,
    assigneeUserId: string,
  ): Promise<ApprovalRequestDetailDTO> =>
    request<{ item: ApprovalRequestDetailDTO }>(
      `/console/approvals/${id}/steps/${stepNo}/reassign`,
      locale,
      { method: "POST", body: JSON.stringify({ assigneeUserId }) },
    ).then((r) => r.item),
};

/* ── Post-activation change requests (M4.5, #60) — the vendor-profile banner ───────────────────── */

/** A raised change as the profile reads it — the kind, its route progress, and the proposed diff. */
export type ChangeRequestDTO = {
  requestId: string;
  kind: "bank" | "non_bank";
  trigger: string;
  status: string;
  currentStepNo: number;
  payload: VendorChangeInput | null;
  createdAt: string;
};

/**
 * The change diff a raise POSTs (M4.6b, #67) — the client-assembled shape. Loosely typed on purpose: the
 * console composes it from the profile form / bank block, and the server re-validates it with the shared
 * `@vms/domain` Zod (`vendorChangeInput`) — so a bad shape returns a localized 4xx rather than being
 * blocked at compile time on a type the client can't fully guarantee anyway.
 */
export type RaiseChangeInput =
  | { kind: "non_bank"; profile: Record<string, string | number> }
  | { kind: "bank"; banks: Record<string, unknown>[] };

export const changesApi = {
  /**
   * Raise a post-activation edit (M4.6b, #67) — POSTs the `{kind, profile}` / `{kind, banks}` diff to
   * `/vendors/:id/change-requests`. The server routes it (bank → AP Manager, non-bank → AP Supervisor),
   * flags the record, and returns the opened change; its guards (422 completeness / bank-remark, 409
   * `changePending` one-per-vendor lock) come back localized as a {@link VendorApiError}.
   */
  raise: (locale: string, vendorId: string, change: RaiseChangeInput): Promise<ChangeRequestDTO> =>
    request<{ item: ChangeRequestDTO }>(`/vendors/${vendorId}/change-requests`, locale, {
      method: "POST",
      body: JSON.stringify(change),
    }).then((r) => r.item),

  /** The vendor's open change (or `null` if none) — powers the "under review" banner. */
  current: async (locale: string, vendorId: string): Promise<ChangeRequestDTO | null> => {
    try {
      return await request<{ item: ChangeRequestDTO }>(
        `/vendors/${vendorId}/change-requests/current`,
        locale,
      ).then((r) => r.item);
    } catch (e) {
      // 404 = no open change; anything else is a real error worth surfacing.
      if ((e as VendorApiError).status === 404) return null;
      throw e;
    }
  },

  /** The submitter withdraws the open change pre-decision → clears the flag, vendor stays Active. */
  cancel: (locale: string, vendorId: string): Promise<void> =>
    request<{ ok: true }>(`/vendors/${vendorId}/change-requests/cancel`, locale, {
      method: "POST",
      body: JSON.stringify({}),
    }).then(() => undefined),
};
