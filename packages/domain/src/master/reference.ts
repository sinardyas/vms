/**
 * Master-data referential-integrity contract (M2.1, #32, ADR-0011).
 *
 * The Phase-0 invariant every master list obeys (domain-model §"Master data"):
 *
 *   > A Vendor field must reference an **active** master row **at capture**; deactivating a row hides
 *   > it from **new** captures, **never** breaks existing references.
 *
 * Deactivation is therefore a *soft* state, split across two read paths — the framework encodes the
 * split so no list re-derives it:
 *
 *   - **Capture reads** (registration dropdowns, M3) offer **capturable rows only** — `active === true`.
 *     A new vendor can only ever point at a live master row. Use {@link capturableOnly} / the API's
 *     `GET …?active=true`.
 *   - **Resolution reads** (rendering an *existing* reference — a vendor already pointing at a row, an
 *     audit view, a report) resolve **by id regardless of `active`**, so a deactivated row still
 *     displays. Never filter these by `active`; that is what would "break existing references".
 *
 * `active` (the `activeFlag` column in `@vms/db`) is thus never a hard delete — rows are retained
 * forever so historical references keep resolving. `document_master` spells the same flag `enabled`;
 * a caller passes whichever boolean field is its capturable predicate.
 */

/** The minimal shape of a master row for the capturable check — just its soft-enable flag. */
export interface CapturableRow {
  readonly active: boolean;
}

/**
 * Is this master row offerable in a **new** capture? True iff it is active. The single predicate the
 * capture path filters on; the resolution path must **not** use it (existing refs resolve regardless).
 */
export const isCapturable = <T extends CapturableRow>(row: T): boolean => row.active;

/** Keep only the rows a new capture may reference (active). Leaves resolution reads untouched. */
export const capturableOnly = <T extends CapturableRow>(rows: readonly T[]): T[] =>
  rows.filter(isCapturable);
