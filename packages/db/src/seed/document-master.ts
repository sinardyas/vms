/**
 * Document-master seed (M2.3, #34, ADR-0013) — the compliance document types requested from vendors,
 * plus the category→document requirements the M5.2 activation gate reads. Seeded so a fresh
 * `docker compose up` lands testers on a populated Document Master screen and a demonstrable required
 * set: `required(origin, category) = { doc_master : applies_to ⊇ origin ∧ mandatory } ∪
 * { doc via category_document_requirements(category) : mandatory }`.
 *
 * The 21 document types (DOC-000…020) are sourced from the prototype `staff_console.html` document
 * master (the reference #10 flagged), given bilingual `name_id` / `name_en`. The category-requirements
 * wiring maps the two `Category`-type licenses (+ ISO 9001) onto the tanker-supply categories that
 * actually need them, so a Bunker-Fuel or Spare-Parts vendor's required set visibly exceeds the plain
 * origin set — the end-to-end demonstrability the DoD asks for.
 *
 * Idempotent (re-runnable on every boot): documents upsert on their unique `no`; requirements resolve
 * their `category_id` (by the seeded category `name_en`) + `document_master_id` (by `no`) and upsert on
 * the `(category_id, document_master_id)` unique index. Re-seeding sets `enabled` / `active` back to
 * true (the "seed activates every row it references" rule, seed-matrix §0).
 */

import { and, eq } from "drizzle-orm";
import type { DB } from "../index";
import { categoryDocumentRequirements, documentMaster, vendorCategories } from "../schema/master-data";

type AppliesTo = "local" | "foreign" | "both";

/** One document-master row. `type`/`reminder` are single-language config values (not localized). */
export type DocumentSeed = {
  readonly no: string;
  readonly nameId: string;
  readonly nameEn: string;
  readonly type: string;
  readonly appliesTo: AppliesTo;
  readonly validityDays: number;
  readonly mandatory: boolean;
  readonly reminder?: string;
};

/** DOC-000…020 — the compliance document master, bilingual, from the prototype reference. */
export const DOCUMENT_MASTER_SEED: readonly DocumentSeed[] = [
  { no: "DOC-000", nameId: "Pakta Integritas", nameEn: "Integrity Pact", type: "Legal", appliesTo: "both", validityDays: 0, mandatory: true },
  { no: "DOC-001", nameId: "SIUP / NIB", nameEn: "Business License (SIUP / NIB)", type: "Legal", appliesTo: "local", validityDays: 0, mandatory: true },
  { no: "DOC-002", nameId: "NPWP", nameEn: "Tax ID (NPWP)", type: "Tax", appliesTo: "local", validityDays: 0, mandatory: true },
  { no: "DOC-003", nameId: "PKP / SPPKP", nameEn: "VAT-able Entrepreneur (PKP / SPPKP)", type: "Tax", appliesTo: "local", validityDays: 0, mandatory: false },
  { no: "DOC-004", nameId: "Akta + SK Kemenkumham", nameEn: "Deed of Establishment + Ministry Decree", type: "Legal", appliesTo: "local", validityDays: 0, mandatory: true },
  { no: "DOC-005", nameId: "SMK3 (K3 / HSE)", nameEn: "OHS Management System (SMK3)", type: "HSE", appliesTo: "both", validityDays: 1095, mandatory: true },
  { no: "DOC-006", nameId: "Konfirmasi Rekening Bank", nameEn: "Bank Account Confirmation", type: "Finance", appliesTo: "both", validityDays: 0, mandatory: true },
  { no: "DOC-007", nameId: "Sertifikat TKDN", nameEn: "Local Content (TKDN) Certificate", type: "Local Content", appliesTo: "local", validityDays: 1095, mandatory: false },
  { no: "DOC-008", nameId: "Akta Pendirian (Certificate of Incorporation)", nameEn: "Certificate of Incorporation", type: "Legal", appliesTo: "foreign", validityDays: 0, mandatory: true },
  { no: "DOC-009", nameId: "Registrasi Pajak (Negara Asal)", nameEn: "Tax Registration (Home Country)", type: "Tax", appliesTo: "foreign", validityDays: 0, mandatory: true },
  { no: "DOC-010", nameId: "Surat Keterangan Domisili — Form DGT", nameEn: "Tax Residency Certificate — Form DGT", type: "Tax", appliesTo: "foreign", validityDays: 365, mandatory: true },
  { no: "DOC-011", nameId: "Anggaran Dasar (Articles of Association)", nameEn: "Articles of Association", type: "Legal", appliesTo: "foreign", validityDays: 0, mandatory: true },
  { no: "DOC-012", nameId: "W-8BEN-E", nameEn: "W-8BEN-E", type: "Tax", appliesTo: "foreign", validityDays: 1095, mandatory: false },
  { no: "DOC-013", nameId: "ISO 9001:2015", nameEn: "ISO 9001:2015", type: "Quality", appliesTo: "both", validityDays: 1095, mandatory: false },
  // Category-type licenses are NOT origin-mandatory (that would require them of every local/foreign
  // vendor); they're scoped to the categories that need them via category_document_requirements
  // (ADR-0013). So DOC-014 is doc-level optional and wired mandatory onto Bunker Fuel below — that is
  // what makes a category's required set genuinely exceed the plain origin set.
  { no: "DOC-014", nameId: "Izin Niaga BBM", nameEn: "Fuel (BBM) Trading License", type: "Category", appliesTo: "local", validityDays: 1825, mandatory: false },
  { no: "DOC-015", nameId: "Surat Penunjukan Distributor", nameEn: "Distributor Authorization", type: "Category", appliesTo: "both", validityDays: 0, mandatory: false },
  { no: "DOC-016", nameId: "Certificate of Residency (COR)", nameEn: "Certificate of Residency (COR)", type: "Tax", appliesTo: "foreign", validityDays: 365, mandatory: true, reminder: "2 weeks" },
  { no: "DOC-017", nameId: "Izin Usaha (Business License)", nameEn: "Business License", type: "Legal", appliesTo: "foreign", validityDays: 0, mandatory: true },
  { no: "DOC-018", nameId: "Bukti Rekening Bank (Buku Tabungan)", nameEn: "Bank Account Proof (Passbook)", type: "Bank", appliesTo: "both", validityDays: 0, mandatory: true },
  { no: "DOC-019", nameId: "KTP Pemilik Rekening", nameEn: "Account Holder ID (KTP) — if account ≠ company", type: "Bank", appliesTo: "local", validityDays: 0, mandatory: false },
  { no: "DOC-020", nameId: "Formulir Ketentuan AP", nameEn: "AP Terms Form", type: "Finance", appliesTo: "both", validityDays: 0, mandatory: false },
];

/** A category-requirement to wire: a vendor category (by seeded `name_en`) requires a doc (by `no`). */
export type RequirementSeed = {
  readonly categoryNameEn: string;
  readonly docNo: string;
  readonly mandatory: boolean;
};

/**
 * The category→document wiring. Maps the two `Category`-type licenses (DOC-014 fuel-trading, DOC-015
 * distributor) + ISO 9001 (DOC-013) onto the tanker-supply categories that need them, so the gate's
 * required set is `origin ∪ single-category` and visibly demonstrable per category (seed-matrix #10).
 * Category names must match `VENDOR_CATEGORY_SEED` (SEED-1) `name_en` exactly.
 */
export const CATEGORY_REQUIREMENT_SEED: readonly RequirementSeed[] = [
  { categoryNameEn: "Bunker Fuel", docNo: "DOC-014", mandatory: true },
  { categoryNameEn: "Spare Parts", docNo: "DOC-015", mandatory: true },
  { categoryNameEn: "Lubricants", docNo: "DOC-015", mandatory: true },
  { categoryNameEn: "Paint & Coating", docNo: "DOC-015", mandatory: true },
  { categoryNameEn: "Survey Services", docNo: "DOC-013", mandatory: true },
  { categoryNameEn: "Shipyard / Drydock", docNo: "DOC-013", mandatory: true },
];

const APPLIES_TO: ReadonlySet<string> = new Set(["local", "foreign", "both"]);

/**
 * Static invariants over the seed data, checked before any write so a malformed list fails loudly (and
 * is unit-tested without a DB in `document-master.test.ts`). Enforces: the full DOC-000…020 range,
 * unique `no`, valid `applies_to`, non-negative validity, non-blank bilingual sides, and that every
 * category-requirement references a real seeded doc `no`.
 */
export const assertDocumentSeedConsistent = (): void => {
  const nos = DOCUMENT_MASTER_SEED.map((d) => d.no);
  const seen = new Set<string>();
  for (const no of nos) {
    if (seen.has(no)) throw new Error(`[seed] duplicate document no: ${no}`);
    seen.add(no);
  }

  // The full contiguous DOC-000…020 range (21 documents) the DoD names.
  if (DOCUMENT_MASTER_SEED.length !== 21)
    throw new Error(`[seed] expected 21 documents (DOC-000…020), got ${DOCUMENT_MASTER_SEED.length}`);
  for (let i = 0; i <= 20; i++) {
    const expected = `DOC-${String(i).padStart(3, "0")}`;
    if (!seen.has(expected)) throw new Error(`[seed] missing document ${expected}`);
  }

  for (const d of DOCUMENT_MASTER_SEED) {
    if (!APPLIES_TO.has(d.appliesTo))
      throw new Error(`[seed] document ${d.no} has invalid appliesTo: ${d.appliesTo}`);
    if (d.validityDays < 0 || !Number.isInteger(d.validityDays))
      throw new Error(`[seed] document ${d.no} has invalid validityDays: ${d.validityDays}`);
    if (!d.nameId.trim() || !d.nameEn.trim())
      throw new Error(`[seed] document ${d.no} has a blank bilingual label`);
    if (!d.type.trim()) throw new Error(`[seed] document ${d.no} has a blank type`);
  }

  for (const r of CATEGORY_REQUIREMENT_SEED) {
    if (!seen.has(r.docNo))
      throw new Error(`[seed] requirement references unknown document ${r.docNo}`);
    if (!r.categoryNameEn.trim())
      throw new Error(`[seed] requirement for ${r.docNo} has a blank category name`);
  }
};

/**
 * Seed (or re-seed) the document master + category requirements. Idempotent — documents upsert on `no`;
 * requirements resolve category + doc ids and upsert on the `(category_id, document_master_id)` index.
 * Must run **after** the registration-lists seed so `vendor_categories` exist to reference. Returns
 * per-part row counts for the log; `skippedRequirements` reports wirings whose category wasn't seeded.
 */
export const seedDocumentMaster = async (
  db: DB,
): Promise<{ documents: number; requirements: number; skippedRequirements: number }> => {
  assertDocumentSeedConsistent();

  for (const d of DOCUMENT_MASTER_SEED) {
    await db
      .insert(documentMaster)
      .values({
        no: d.no,
        nameId: d.nameId,
        nameEn: d.nameEn,
        type: d.type,
        appliesTo: d.appliesTo,
        validityDays: d.validityDays,
        mandatory: d.mandatory,
        reminder: d.reminder ?? "Off",
      })
      .onConflictDoUpdate({
        target: documentMaster.no,
        set: {
          nameId: d.nameId,
          nameEn: d.nameEn,
          type: d.type,
          appliesTo: d.appliesTo,
          validityDays: d.validityDays,
          mandatory: d.mandatory,
          reminder: d.reminder ?? "Off",
          enabled: true,
          updatedAt: new Date(),
        },
      });
  }

  // Resolve ids once: categories by name_en (seeded by seedRegistrationLists), docs by no.
  const categoryRows = await db
    .select({ id: vendorCategories.id, nameEn: vendorCategories.nameEn })
    .from(vendorCategories);
  const categoryIdByName = new Map(categoryRows.map((r) => [r.nameEn, r.id]));
  const docRows = await db.select({ id: documentMaster.id, no: documentMaster.no }).from(documentMaster);
  const docIdByNo = new Map(docRows.map((r) => [r.no, r.id]));

  let requirements = 0;
  let skippedRequirements = 0;
  for (const r of CATEGORY_REQUIREMENT_SEED) {
    const categoryId = categoryIdByName.get(r.categoryNameEn);
    const documentMasterId = docIdByNo.get(r.docNo);
    if (!categoryId || !documentMasterId) {
      // A wiring whose category isn't in the DB (e.g. a tester deleted it) is skipped, not fatal.
      skippedRequirements++;
      continue;
    }
    await db
      .insert(categoryDocumentRequirements)
      .values({ categoryId, documentMasterId, mandatory: r.mandatory })
      .onConflictDoUpdate({
        target: [categoryDocumentRequirements.categoryId, categoryDocumentRequirements.documentMasterId],
        set: { mandatory: r.mandatory, active: true, updatedAt: new Date() },
      });
    requirements++;
  }

  return { documents: DOCUMENT_MASTER_SEED.length, requirements, skippedRequirements };
};
