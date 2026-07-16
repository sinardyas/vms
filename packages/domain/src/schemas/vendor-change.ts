/**
 * Post-activation edit payload — the diff an Active vendor proposes (M4.5, #60, ADR-0005/0009/0010).
 *
 * Once a vendor is Active its record is frozen (M4.4 `isCaptureEditable` — capture is Draft-only); a
 * change is not written in place but captured as a **diff** riding on an ApprovalRequest and applied only
 * on final approval (ADR-0005). The *kind* of change picks the route (ADR-0009): a **bank** change routes
 * to AP Manager, a **non-bank** change to AP Supervisor. This module is the single source of truth for
 * the diff's shape, so the portal/console that raise a change and the API that applies it never disagree.
 *
 * Two kinds, a discriminated union on `kind`:
 *   - **non_bank** — a proposed replacement of the editable **profile** fields (the M3.1 `vendors`
 *     columns a screen fills in), minus the lifecycle-immutable `origin`/`source` (those never change on
 *     an edit; the server pins them from the live record). The result must still satisfy the per-origin
 *     required set — the raising endpoint checks {@link missingProfileFields} before opening the request.
 *   - **bank** — a proposed replacement of the whole **bank block** ({@link vendorBankBlockSchema}: ≥1
 *     account, exactly one primary, holder-proof when holder ≠ company). Full-set replacement handles
 *     add / edit / remove uniformly; the out-of-country **remark** rule needs the vendor country, so the
 *     raising endpoint layers it on (as M3.2 does) with the live vendor in hand.
 *
 * The parsed value is stored verbatim on `approval_requests.payload` and re-parsed on apply, so a diff
 * that no longer validates (schema drift) is caught rather than applied blindly.
 */

import { z } from "zod";
import { vendorDraftInput } from "./vendor";
import { vendorBankBlockSchema } from "./vendor-bank";

/**
 * The editable profile fields a non-bank change proposes — the Draft shape minus `origin`/`source`,
 * which are lifecycle-immutable on a post-activation edit (the server keeps the live record's values).
 * `name` stays required (the base schema requires it); everything else is optional, and the raising
 * endpoint enforces the per-origin required set on top so an Active vendor can't be edited into an
 * incomplete state.
 */
export const vendorProfileChangeInput = vendorDraftInput.omit({ origin: true, source: true });
export type VendorProfileChangeInput = z.infer<typeof vendorProfileChangeInput>;

/** A proposed non-bank (profile) change — routes to AP Supervisor (ADR-0009 `non_bank_change`). */
export const nonBankChangeSchema = z.object({
  kind: z.literal("non_bank"),
  profile: vendorProfileChangeInput,
});

/** A proposed bank-block change (full replacement set) — routes to AP Manager (ADR-0009 `bank_change`). */
export const bankChangeSchema = z.object({
  kind: z.literal("bank"),
  banks: vendorBankBlockSchema,
});

/** The post-activation edit diff — `bank` (block replacement) or `non_bank` (profile replacement). */
export const vendorChangeInput = z.discriminatedUnion("kind", [
  nonBankChangeSchema,
  bankChangeSchema,
]);
export type VendorChangeInput = z.infer<typeof vendorChangeInput>;

/** The change kind, as callers switch on it (route selection, DTOs). */
export type VendorChangeKind = VendorChangeInput["kind"];

/** The approval trigger a change kind routes on (ADR-0009): bank → AP Manager, non-bank → AP Supervisor. */
export const changeTrigger = (kind: VendorChangeKind): "bank_change" | "non_bank_change" =>
  kind === "bank" ? "bank_change" : "non_bank_change";
