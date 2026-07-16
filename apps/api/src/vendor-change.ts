/**
 * Post-activation change effects — apply / discard a vendor edit diff (M4.5, #60, ADR-0005/0009/0010).
 *
 * The resolution half of a post-activation edit. While a change is pending the Active vendor's live
 * record is untouched and the proposed diff sits on `approval_requests.payload` (raised by
 * `vendor-change-route.ts`, guarded by `change_pending`). When the approval engine resolves that request
 * ({@link applyDecision} → `apply_change` / `discard_change`, in `approval-route.ts`'s decide tx), it
 * calls one of these to land the outcome **in the same transaction** as the request resolution:
 *
 *   - {@link applyVendorChange} — final approval: re-parse the stored diff and write it to the live
 *     record (a **non-bank** diff overwrites the editable profile columns; a **bank** diff replaces the
 *     whole bank block), then clear `change_pending`.
 *   - {@link discardVendorChange} — rejection: leave the record as-is, just clear `change_pending`.
 *
 * The vendor **stays Active** through both (an edit never changes lifecycle state — contrast registration,
 * where the effect activates or returns to Draft). The diff is re-validated on apply against the same
 * `@vms/domain` schema that captured it, so a payload that no longer parses is caught, not applied blind.
 */

import { vendorBankCurrencies, vendorBanks, vendors } from "@vms/db";
import { type VendorChangeInput, vendorChangeInput } from "@vms/domain";
import type { RequestContext } from "@vms/domain";
import { eq } from "drizzle-orm";
import type { Tx } from "./approval-engine";
import { writeAudit } from "./audit";
import { bankValues } from "./vendor-banks-route";
import { profileValues } from "./vendor-route";

/** Re-parse a stored change payload; throws if a persisted diff no longer validates (schema drift). */
const parsePayload = (payload: unknown): VendorChangeInput => {
  const parsed = vendorChangeInput.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`stored vendor-change payload failed to validate: ${parsed.error.message}`);
  }
  return parsed.data;
};

/**
 * Apply a resolved (final-approved) change to the still-Active vendor `vendorId`, inside `tx`:
 *   - **non_bank** — overwrite the editable profile columns from the diff (lifecycle columns untouched).
 *   - **bank** — replace the whole bank block: drop the current accounts (currencies cascade) and insert
 *     the proposed set. The diff was validated to hold exactly one primary, so the re-inserted rows
 *     satisfy the `vendor_banks_one_primary_uq` partial index without any reconciliation.
 * Clears `change_pending` and audits, all in the caller's transaction.
 */
export const applyVendorChange = async (
  tx: Tx,
  ctx: RequestContext,
  vendorId: string,
  payload: unknown,
): Promise<void> => {
  const change = parsePayload(payload);
  const now = new Date();

  if (change.kind === "non_bank") {
    // `origin`/`source`/`status` are lifecycle-owned — `profileValues` never touches them, so the live
    // record's origin and Active status survive the overwrite; `change_pending` is cleared here.
    await tx
      .update(vendors)
      .set({ ...profileValues(change.profile), changePending: false, updatedAt: now })
      .where(eq(vendors.id, vendorId));
  } else {
    // Full-set replacement handles add/edit/remove uniformly. Delete first (currencies cascade off the
    // banks' FK), then insert the proposed set + its currency links; exactly one row carries isPrimary.
    await tx.delete(vendorBanks).where(eq(vendorBanks.vendorId, vendorId));
    for (const bank of change.banks) {
      const [row] = await tx
        .insert(vendorBanks)
        .values({ ...bankValues(vendorId, bank), isPrimary: bank.isPrimary })
        .returning({ id: vendorBanks.id });
      if (!row) throw new Error("vendor_bank insert returned no row");
      if (bank.currencyIds.length > 0) {
        await tx
          .insert(vendorBankCurrencies)
          .values(bank.currencyIds.map((currencyId) => ({ vendorBankId: row.id, currencyId })));
      }
    }
    await tx
      .update(vendors)
      .set({ changePending: false, updatedAt: now })
      .where(eq(vendors.id, vendorId));
  }

  await writeAudit(tx, ctx, {
    action: change.kind === "bank" ? "vendor.bank_change_applied" : "vendor.change_applied",
    module: "vendors",
    subjectType: "vendor",
    subjectId: vendorId,
  });
};

/**
 * Discard a rejected change: the live record is left untouched, only `change_pending` is cleared (the
 * vendor stays Active). Audits the discard in the caller's transaction (`tx`).
 */
export const discardVendorChange = async (
  tx: Tx,
  ctx: RequestContext,
  vendorId: string,
): Promise<void> => {
  await tx
    .update(vendors)
    .set({ changePending: false, updatedAt: new Date() })
    .where(eq(vendors.id, vendorId));
  await writeAudit(tx, ctx, {
    action: "vendor.change_discarded",
    module: "vendors",
    subjectType: "vendor",
    subjectId: vendorId,
  });
};
