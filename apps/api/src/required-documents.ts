/**
 * Required-document-set composition — one query, one place (ADR-0013).
 *
 * A vendor's **mandatory** document types are `origin docs ∪ its single category's docs` — the pure set
 * algebra lives in `@vms/domain` ({@link requiredDocumentSet}); this module only gathers the three
 * inputs it needs from Postgres (the vendor's origin/category, the `document_master` rules, and the
 * category-requirements matrix). Shared verbatim by:
 *   - the **M5.2 activation gate** (`approval-route.ts` `computeActivationGate`) — measures each required
 *     doc's verify state to decide "may this registration activate?", and
 *   - the **M5.3 reject→Draft bounce** (`document-verification-route.ts`) — only a rejection of a doc in
 *     *this* set returns the registration to Draft; an optional (non-required) doc's rejection does not.
 *
 * Keeping the composition in one function is what makes those two agree: the exact set the gate waits on
 * is the exact set whose rejection bounces the vendor — no drift, no restated matrix logic.
 */

import { type DB, categoryDocumentRequirements, documentMaster, vendors } from "@vms/db";
import { requiredDocumentSet } from "@vms/domain";
import { eq } from "drizzle-orm";

/** Anything that can run a Drizzle `select` — the ambient `db` or an open transaction. */
type ReadHandle = Pick<DB, "select">;

/**
 * The mandatory `document_master` ids for a vendor (origin ∪ single-category, ADR-0013), deduplicated.
 * Reads the vendor's origin/category, the master rules, and the requirements matrix, then defers the set
 * algebra to {@link requiredDocumentSet}. Returns `[]` for an unknown vendor (the callers already guard
 * existence). Accepts a transaction handle so it composes atomically inside a decide/verify write.
 */
export const requiredDocMasterIdsForVendor = async (
  handle: ReadHandle,
  vendorId: string,
): Promise<string[]> => {
  const [vendor] = await handle
    .select({ origin: vendors.origin, categoryId: vendors.categoryId })
    .from(vendors)
    .where(eq(vendors.id, vendorId))
    .limit(1);
  if (!vendor) return [];

  const master = await handle
    .select({
      id: documentMaster.id,
      appliesTo: documentMaster.appliesTo,
      mandatory: documentMaster.mandatory,
      enabled: documentMaster.enabled,
    })
    .from(documentMaster);

  const categoryRequirements = await handle
    .select({
      categoryId: categoryDocumentRequirements.categoryId,
      documentMasterId: categoryDocumentRequirements.documentMasterId,
      mandatory: categoryDocumentRequirements.mandatory,
      active: categoryDocumentRequirements.active,
      enabled: documentMaster.enabled,
    })
    .from(categoryDocumentRequirements)
    .innerJoin(
      documentMaster,
      eq(categoryDocumentRequirements.documentMasterId, documentMaster.id),
    );

  return requiredDocumentSet(
    { origin: vendor.origin, categoryId: vendor.categoryId },
    { master, categoryRequirements },
  );
};
