/**
 * The UAT scenario, as data (#88 — the runnable half of [seed-matrix 009]).
 *
 * This module is the *what*: every account, vendor, bank and in-flight approval the matrix specifies,
 * expressed as plain literals with no IO. `scenario.ts` is the *how* — it reads these and writes rows.
 * The split is what makes the scenario reviewable: a stakeholder can read this file and check it
 * against the matrix without following a single database call, and `fixtures.test.ts` can assert the
 * roster's invariants (all six statuses covered, one primary bank each, …) without a Postgres.
 *
 * Two conventions run through the whole file:
 *
 * **Dates are offsets, never literals.** Everything is expressed in days from {@link SEED_DATE}, so a
 * document seeded as "issued 180 days ago, expiring in 900" still reads that way whenever the stack
 * comes up. Hard-coding 2026 dates would leave a UAT run in 2027 staring at a wall of expired
 * certificates and an activation gate that mysteriously refuses to open.
 *
 * **Identity is derived, never random.** Every row's primary key comes from {@link seedUuid} of a
 * stable business key, which is what lets the loader upsert instead of duplicate. See its docs.
 *
 * Master data is referenced **by natural key** (bank name, ISO3, category `nameEn`, `DOC-0xx`) and
 * resolved to ids at load time — the seeds in `@vms/db` own those rows and mint their ids, so naming
 * them here is the only way to reference them without pinning ids this module doesn't control.
 */

import { createHash } from "node:crypto";

/* ── Anchors ─────────────────────────────────────────────────────────────────────────────────── */

/**
 * The fixed instant the scenario is described relative to (seed-matrix §0). Not "now": a scenario
 * pinned to the clock would drift — re-seeding tomorrow would silently produce a *different* scenario
 * (an approval one day staler, a certificate one day closer to expiry) and the loader would stop
 * being idempotent in the only sense that matters, which is that re-running it changes nothing.
 */
export const SEED_DATE = new Date("2026-07-01T00:00:00.000Z");

/**
 * The password every pre-seeded account shares (seed-matrix §0). Printed on the UAT login card and
 * deliberately not a secret — these accounts exist only in a seeded UAT/dev database. Which is also
 * why loading the scenario under `NODE_ENV=production` takes an explicit `SEED_SCENARIO=1`: see the
 * guard in `../seed-scenario.ts`.
 */
export const SEED_PASSWORD = "SoechiUAT#2026";

/** An instant `dayOffset` days from {@link SEED_DATE} (negative = before it). */
export const seedInstant = (dayOffset: number): Date =>
  new Date(SEED_DATE.getTime() + dayOffset * 24 * 60 * 60 * 1000);

/** A `YYYY-MM-DD` calendar date `dayOffset` days from {@link SEED_DATE} — for `date` columns. */
export const seedDay = (dayOffset: number): string =>
  seedInstant(dayOffset).toISOString().slice(0, 10);

/**
 * A stable UUID derived from a business key — `seedUuid("vendor:bahari")` is the same uuid on every
 * run, on every machine, forever.
 *
 * This is what makes the loader idempotent. Most seeded tables have no natural unique key to upsert
 * on (`vendor_banks`, `approval_requests`, `files` — a vendor's name isn't unique, a Draft's tax id
 * isn't either), so `onConflictDoUpdate` needs *some* stable target, and the primary key is the only
 * one available. Deriving it from the key rather than numbering rows also means the ids survive
 * reordering or inserting into the middle of the roster below.
 *
 * SHA-1 is a namespacing device here, not a security one — this is exactly the construction of a
 * UUIDv5, with the version/variant nibbles forced to `4`/`8` so the value satisfies anything that
 * validates a v4 uuid. Nothing about the scenario is secret.
 */
export const seedUuid = (key: string): string => {
  const h = createHash("sha1").update(`vms-uat-seed:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/* ── §1 Accounts ─────────────────────────────────────────────────────────────────────────────── */

/** One pre-verified staff login (seed-matrix §1.1) and the single role it holds. */
export type StaffSeed = {
  readonly email: string;
  readonly name: string;
  /** Role `code` from `@vms/db`'s `seedAccess` — this account is also seeded as that role's lead. */
  readonly roleCode: string;
};

/**
 * The six console logins (seed-matrix §1.1), one per staff actor in the domain model. Each is the
 * **lead** of its role (ADR-0012), which is what finally closes M4.2's auto-assign gap: with no lead
 * seeded, every step a route opened landed `assignee_user_id = null` and no queue was ever anyone's.
 *
 * One role each, deliberately — the SoD demonstrations (a submitter who cannot approve, a verifier
 * who cannot approve the vendor they verified) only mean anything if no account quietly holds two
 * hats. `sysadmin` is the exception the design already grants: it holds the full grid, including the
 * `approvals:edit` override authority M4.3 escalates to when a step has zero eligible approvers.
 */
export const STAFF_SEED: readonly StaffSeed[] = [
  { email: "apstaff@vms.test", name: "Rina Kusuma", roleCode: "ap_staff" },
  { email: "apsuper@vms.test", name: "Bagus Prakoso", roleCode: "ap_supervisor" },
  { email: "apmanager@vms.test", name: "Dewi Lestari", roleCode: "ap_manager" },
  { email: "hod@vms.test", name: "Hendra Wibowo", roleCode: "hod" },
  { email: "verifier@vms.test", name: "Sari Wijaya", roleCode: "document_verifier" },
  { email: "sysadmin@vms.test", name: "Adi Nugroho", roleCode: "system_administrator" },
];

/**
 * The account the seed must **not** create (seed-matrix §1.3). `newvendor@example.com` is the tester's
 * from-scratch path — sign up on the portal, collect the verification mail in Mailpit, click through.
 * Every seeded account skips that step (`emailVerified = true`), so this is the *only* place the
 * email-verify flow gets exercised; seeding it would delete the one test that covers it. Asserted in
 * `fixtures.test.ts` so a future roster edit can't quietly claim the address.
 */
export const UNSEEDED_SIGNUP_EMAIL = "newvendor@example.com";

/* ── §2 Vendor roster ────────────────────────────────────────────────────────────────────────── */

/** How a vendor's compliance documents are staged — which queue the vendor lands in (§2.3). */
export type DocumentPlan =
  /** Every required doc Verified with real dates — the activation gate is satisfied *by data*. */
  | { readonly kind: "verified" }
  /** Every required doc uploaded but un-decided — populates the Document Verifier queue. */
  | { readonly kind: "pending" }
  /** One named doc Rejected with a reason (which is why the vendor is back in Draft); rest Verified. */
  | { readonly kind: "rejected"; readonly docNo: string; readonly reason: string }
  /** Only these docs exist, all un-decided — a genuinely half-finished Draft. */
  | { readonly kind: "partial"; readonly docNos: readonly string[] };

/** One bank account (§2.2). `bankName` / `bankCountryIso3` / `currencyCodes` resolve to master rows. */
export type BankSeed = {
  /** Stable key within the vendor — feeds {@link seedUuid}, so it must not be reused. */
  readonly key: string;
  /** Must match a `BANK_SEED` master `name` in `@vms/db` — resolved to `vendor_banks.bank_id`. */
  readonly bankName: string;
  readonly accountNo: string;
  readonly holderName: string;
  readonly branch: string;
  readonly description?: string;
  readonly swift?: string;
  readonly bankCountryIso3: string;
  readonly currencyCodes: readonly string[];
  readonly isPrimary: boolean;
  readonly holderSameAsCompany: boolean;
  /** Required by the M3.2 invariant when the bank's country differs from the vendor's. */
  readonly differsFromCompanyRemark?: string;
};

/** Per-document detail worth stating by hand — everything else is derived from the master row. */
export type DocumentOverride = {
  readonly refNo?: string;
  readonly variant?: string;
};

/** One seeded vendor: the whole aggregate (§2, §2.1, §2.2, §2.3). */
export type VendorSeed = {
  /** Stable key — feeds {@link seedUuid} and the recognisable MinIO object names. */
  readonly slug: string;
  readonly name: string;
  readonly ownerEmail: string;
  readonly ownerName: string;
  /** The language this owner reads — drives what their notifications render in (M6.1). */
  readonly ownerLocale: "id" | "en";
  readonly origin: "local" | "foreign";
  readonly source: "self" | "office";
  readonly status: "draft" | "pending" | "pending_hod" | "active" | "inactive";
  /** Assigned on activation (ADR-0015) — so only vendors that have *been* activated carry one. */
  readonly shortCode?: string;
  readonly categoryNameEn: string;
  readonly businessEntityNameEn: string;
  readonly countryIso3: string;
  readonly taxId?: string;
  readonly taxStatus?:
    | "pkp_corporate"
    | "pkp_individual"
    | "non_pkp_corporate"
    | "non_pkp_individual";
  readonly npwpType?: "personal" | "head_office" | "branch";
  readonly companyScale?: "kecil" | "menengah" | "besar";
  readonly procurementNote?: string;
  readonly address: string;
  readonly city: string;
  readonly postal: string;
  readonly phone: string;
  readonly fax?: string;
  readonly yearFounded: number;
  readonly website: string;
  readonly email: string;
  readonly commissioner: string;
  readonly director: string;
  readonly picName: string;
  readonly picRole: string;
  readonly picPhone: string;
  readonly picEmail: string;
  readonly soechiReference: string;
  readonly paymentTerm: "credit_30" | "credit_45" | "credit_60" | "cod" | "agent";
  /** Why the vendor is out of service — set iff `status === "inactive"` (M6.4). */
  readonly inactiveReason?: string;
  readonly banks: readonly BankSeed[];
  readonly documents: DocumentPlan;
  readonly documentOverrides?: Readonly<Record<string, DocumentOverride>>;
  /** How long ago (in days from {@link SEED_DATE}) this vendor's certificates were issued. */
  readonly documentsIssuedDaysAgo: number;
};

/**
 * The eight-vendor roster (seed-matrix §2) — fictional Indonesian tanker-shipping suppliers spanning
 * **all five reachable** `vendor_status` values × both origins. (`blacklisted` is the sixth and stays
 * empty on purpose: it is only reachable through the Violations pillar, which is Phase 3.)
 *
 * Every vendor carries a complete profile, because the scenario's job is to make screens *reviewable* —
 * a blank field in UAT reads as a bug in the form, not as an unfilled fixture, and costs a round-trip
 * to find out which.
 *
 * Category names must exist in `@vms/db`'s `VENDOR_CATEGORY_SEED`. Note vendor 8: the matrix calls it a
 * "Port Agent", but the 15 categories M2.3 actually shipped have no such row, so it is seeded under
 * **Logistics / Freight**. Adding a category is a master-data change, not a fixture change — see the
 * ticket's resolution.
 */
export const VENDOR_SEED: readonly VendorSeed[] = [
  {
    slug: "bahari",
    name: "PT Bahari Bunker Nusantara",
    ownerEmail: "owner+bahari@vendor.test",
    ownerName: "Yusuf Hakim",
    ownerLocale: "id",
    origin: "local",
    source: "self",
    status: "active",
    shortCode: "BBN0001",
    categoryNameEn: "Bunker Fuel",
    businessEntityNameEn: "PT (Limited Company)",
    countryIso3: "IDN",
    taxId: "01.234.567.8-051.000",
    taxStatus: "pkp_corporate",
    npwpType: "head_office",
    companyScale: "besar",
    procurementNote: "Terdaftar sebagai pemasok bunker MFO & MGO untuk armada tanker.",
    address: "Jl. Yos Sudarso No. 88, Tanjung Priok",
    city: "Jakarta Utara",
    postal: "14320",
    phone: "+62 21 4300 881",
    fax: "+62 21 4300 882",
    yearFounded: 2004,
    website: "https://baharibunker.co.id",
    email: "info@baharibunker.co.id",
    commissioner: "Hartono Salim",
    director: "Yusuf Hakim",
    picName: "Yusuf Hakim",
    picRole: "Direktur Utama",
    picPhone: "+62 811 1900 881",
    picEmail: "yusuf.hakim@baharibunker.co.id",
    soechiReference: "PT Soechi Lines — Bunker Procurement",
    paymentTerm: "credit_30",
    banks: [
      {
        key: "primary",
        bankName: "Bank Central Asia (BCA)",
        accountNo: "0881234567",
        holderName: "PT Bahari Bunker Nusantara",
        branch: "KCU Tanjung Priok",
        description: "Rekening operasional bunker",
        bankCountryIso3: "IDN",
        currencyCodes: ["IDR"],
        isPrimary: true,
        holderSameAsCompany: true,
      },
    ],
    documents: { kind: "verified" },
    documentOverrides: {
      "DOC-001": { refNo: "NIB 9120001042004" },
      "DOC-004": { refNo: "No. 42 tanggal 14 Mei 2004", variant: "Pendirian" },
    },
    documentsIssuedDaysAgo: 420,
  },
  {
    slug: "samudra",
    name: "PT Samudra Sparepart Marindo",
    ownerEmail: "owner+samudra@vendor.test",
    ownerName: "Ratna Prameswari",
    ownerLocale: "id",
    origin: "local",
    source: "office",
    status: "active",
    shortCode: "SSM0002",
    categoryNameEn: "Spare Parts",
    businessEntityNameEn: "PT (Limited Company)",
    countryIso3: "IDN",
    taxId: "02.345.678.9-611.000",
    taxStatus: "pkp_corporate",
    npwpType: "head_office",
    companyScale: "menengah",
    procurementNote: "Distributor resmi suku cadang mesin induk MAN B&W dan Yanmar.",
    address: "Jl. Rungkut Industri III No. 21",
    city: "Surabaya",
    postal: "60293",
    phone: "+62 31 8430 210",
    fax: "+62 31 8430 211",
    yearFounded: 2011,
    website: "https://samudramarindo.co.id",
    email: "sales@samudramarindo.co.id",
    commissioner: "Lie Tjong Han",
    director: "Ratna Prameswari",
    picName: "Bambang Setiawan",
    picRole: "Manajer Penjualan",
    picPhone: "+62 812 3055 210",
    picEmail: "bambang@samudramarindo.co.id",
    soechiReference: "PT Multi Ocean Shipyard — Procurement",
    paymentTerm: "credit_45",
    banks: [
      {
        key: "primary",
        bankName: "Bank Mandiri",
        accountNo: "1400021345678",
        holderName: "PT Samudra Sparepart Marindo",
        branch: "KCP Rungkut Surabaya",
        description: "Rekening utama penjualan",
        bankCountryIso3: "IDN",
        currencyCodes: ["IDR"],
        isPrimary: true,
        holderSameAsCompany: true,
      },
    ],
    documents: { kind: "verified" },
    documentOverrides: {
      "DOC-001": { refNo: "NIB 8120014562011" },
      "DOC-004": { refNo: "No. 08 tanggal 3 Februari 2019", variant: "Perubahan Nama" },
    },
    documentsIssuedDaysAgo: 300,
  },
  {
    slug: "chandler",
    name: "PT Chandler Provisi Bahari",
    ownerEmail: "owner+chandler@vendor.test",
    ownerName: "Made Suryanto",
    ownerLocale: "id",
    origin: "local",
    source: "self",
    status: "pending",
    categoryNameEn: "Provisions / Chandler",
    businessEntityNameEn: "CV (Limited Partnership)",
    countryIso3: "IDN",
    taxId: "03.456.789.0-724.000",
    taxStatus: "non_pkp_corporate",
    npwpType: "head_office",
    companyScale: "kecil",
    procurementNote: "Pemasok provisi kapal dan bonded store untuk pelayaran domestik.",
    address: "Jl. Ikan Kakap No. 7, Perak Utara",
    city: "Surabaya",
    postal: "60165",
    phone: "+62 31 3291 774",
    yearFounded: 2018,
    website: "https://chandlerprovisi.co.id",
    email: "office@chandlerprovisi.co.id",
    commissioner: "Nyoman Adiputra",
    director: "Made Suryanto",
    picName: "Made Suryanto",
    picRole: "Direktur",
    picPhone: "+62 813 3877 774",
    picEmail: "made@chandlerprovisi.co.id",
    soechiReference: "PT Soechi Lines — Ship Chandling",
    paymentTerm: "cod",
    banks: [
      {
        // The one vendor whose account is not in the company's own name (§2.2) — so the
        // holder-proof invariant (KTP + Surat Pernyataan required) is visible in UAT rather than
        // only in the test suite.
        key: "primary",
        bankName: "Bank Negara Indonesia (BNI)",
        accountNo: "0774112233",
        holderName: "Made Suryanto",
        branch: "KCP Perak Surabaya",
        description: "Rekening atas nama direktur (CV belum berbadan hukum penuh)",
        bankCountryIso3: "IDN",
        currencyCodes: ["IDR"],
        isPrimary: true,
        holderSameAsCompany: false,
      },
    ],
    documents: { kind: "pending" },
    documentOverrides: {
      "DOC-001": { refNo: "NIB 0220107743018" },
      "DOC-004": { refNo: "No. 15 tanggal 9 Juli 2018", variant: "Pendirian" },
    },
    documentsIssuedDaysAgo: 200,
  },
  {
    slug: "galangan",
    name: "PT Galangan Docking Jaya",
    ownerEmail: "owner+galangan@vendor.test",
    ownerName: "Iwan Kurniawan",
    ownerLocale: "id",
    origin: "local",
    source: "office",
    status: "pending_hod",
    categoryNameEn: "Shipyard / Drydock",
    businessEntityNameEn: "PT (Limited Company)",
    countryIso3: "IDN",
    taxId: "04.567.890.1-092.000",
    taxStatus: "pkp_corporate",
    npwpType: "head_office",
    companyScale: "besar",
    procurementNote: "Graving dock 8.000 DWT; docking berkala dan repair lambung.",
    address: "Jl. Kalianget No. 12, Kawasan Galangan",
    city: "Semarang",
    postal: "50174",
    phone: "+62 24 3552 908",
    fax: "+62 24 3552 909",
    yearFounded: 1998,
    website: "https://galangandockingjaya.co.id",
    email: "yard@galangandockingjaya.co.id",
    commissioner: "Soekarno Wijaya",
    director: "Iwan Kurniawan",
    picName: "Tri Handoko",
    picRole: "Manajer Produksi",
    picPhone: "+62 815 6420 908",
    picEmail: "tri.handoko@galangandockingjaya.co.id",
    soechiReference: "PT Multi Ocean Shipyard — Docking Programme",
    paymentTerm: "credit_60",
    banks: [
      {
        key: "primary",
        bankName: "Bank Central Asia (BCA)",
        accountNo: "0093456789",
        holderName: "PT Galangan Docking Jaya",
        branch: "KCU Semarang",
        description: "Rekening kontrak docking",
        bankCountryIso3: "IDN",
        currencyCodes: ["IDR"],
        isPrimary: true,
        holderSameAsCompany: true,
      },
    ],
    // Verified, not Pending — the matrix leaves this vendor's verify state unstated, but the HOD
    // golden path (§5.3: "as hod, activate") runs *through* the M5.2 activation gate. Left
    // un-verified, the HOD's approval would be refused with `gate_blocked` and the queue item the
    // seed exists to provide would dead-end. Vendor 3 is where the gate is demonstrated.
    documents: { kind: "verified" },
    documentOverrides: {
      "DOC-001": { refNo: "NIB 9120309081998" },
      "DOC-004": { refNo: "No. 03 tanggal 21 Januari 1998", variant: "Pendirian" },
    },
    documentsIssuedDaysAgo: 260,
  },
  {
    slug: "krewing",
    name: "PT Krewing Maritim Sentosa",
    ownerEmail: "owner+krewing@vendor.test",
    ownerName: "Agus Salim",
    ownerLocale: "id",
    origin: "local",
    source: "self",
    status: "draft",
    categoryNameEn: "Crewing / Manning",
    businessEntityNameEn: "Sole Proprietorship",
    countryIso3: "IDN",
    taxId: "05.678.901.2-405.000",
    taxStatus: "non_pkp_individual",
    npwpType: "personal",
    companyScale: "kecil",
    procurementNote: "Penyedia awak kapal (deck & engine rating) bersertifikat BST.",
    address: "Jl. Pelabuhan Ratu No. 30",
    city: "Cilacap",
    postal: "53211",
    phone: "+62 282 534 771",
    yearFounded: 2016,
    website: "https://krewingmaritim.co.id",
    email: "crew@krewingmaritim.co.id",
    commissioner: "Agus Salim",
    director: "Agus Salim",
    picName: "Agus Salim",
    picRole: "Pemilik",
    picPhone: "+62 819 2244 771",
    picEmail: "agus@krewingmaritim.co.id",
    soechiReference: "PT Soechi Lines — Crewing Department",
    paymentTerm: "credit_30",
    banks: [
      {
        key: "primary",
        bankName: "Bank Mandiri",
        accountNo: "1350077112233",
        holderName: "Agus Salim",
        branch: "KCP Cilacap",
        bankCountryIso3: "IDN",
        currencyCodes: ["IDR"],
        isPrimary: true,
        holderSameAsCompany: true, // a sole proprietorship banks in the proprietor's own name
      },
    ],
    // Why this vendor is back in Draft: a mandatory doc was rejected (§4 "Rejection / resubmit").
    documents: {
      kind: "rejected",
      docNo: "DOC-001",
      reason: "SIUP sudah kedaluwarsa — unggah sertifikat yang telah diperbarui.",
    },
    documentOverrides: {
      "DOC-001": { refNo: "NIB 0220167712016" },
      "DOC-004": { refNo: "No. 27 tanggal 5 Oktober 2016", variant: "Pendirian" },
    },
    documentsIssuedDaysAgo: 150,
  },
  {
    slug: "marinesurvey",
    name: "Marine Survey Global Pte Ltd",
    ownerEmail: "owner+marinesurvey@vendor.test",
    ownerName: "Daniel Tan",
    ownerLocale: "en",
    origin: "foreign",
    source: "self",
    status: "active",
    shortCode: "MSG0006",
    categoryNameEn: "Survey Services",
    businessEntityNameEn: "Pte. Ltd.",
    countryIso3: "SGP",
    // Foreign vendors leave the Indonesian tax fields null (§2.1); the tax id column carries the
    // home-country registration instead — it is the dedup key regardless of what kind of number it is.
    taxId: "201432871K",
    procurementNote: "Class-approved marine warranty surveyor; IACS member society panel.",
    address: "12 Marina Boulevard, #21-03, Marina Bay Financial Centre",
    city: "Singapore",
    postal: "018982",
    phone: "+65 6532 4180",
    fax: "+65 6532 4181",
    yearFounded: 2009,
    website: "https://marinesurveyglobal.com.sg",
    email: "enquiry@marinesurveyglobal.com.sg",
    commissioner: "Cheong Wai Keong",
    director: "Daniel Tan",
    picName: "Priya Raman",
    picRole: "Operations Manager",
    picPhone: "+65 9127 4180",
    picEmail: "priya.raman@marinesurveyglobal.com.sg",
    soechiReference: "PT Soechi Lines — Marine Assurance",
    paymentTerm: "credit_30",
    banks: [
      {
        key: "primary",
        bankName: "DBS Bank",
        accountNo: "0072-018982-01",
        holderName: "Marine Survey Global Pte Ltd",
        branch: "Marina Bay",
        description: "Primary settlement account",
        swift: "DBSSSGSG",
        bankCountryIso3: "SGP", // same country as the vendor — no remark required
        currencyCodes: ["SGD", "USD"],
        isPrimary: true,
        holderSameAsCompany: true,
      },
    ],
    documents: { kind: "verified" },
    documentsIssuedDaysAgo: 240,
  },
  {
    slug: "oceanspare",
    name: "Ocean Spare Parts Co., Ltd",
    ownerEmail: "owner+oceanspare@vendor.test",
    ownerName: "Li Wei",
    ownerLocale: "en",
    origin: "foreign",
    source: "self",
    status: "draft",
    categoryNameEn: "Spare Parts",
    businessEntityNameEn: "Co., Ltd.",
    countryIso3: "CHN",
    // No tax id yet — this is a genuinely half-filled Draft a tester resumes (§5.2), not a
    // complete record wearing a Draft label. The M3.4 submit gate will name what is still missing.
    procurementNote: "Marine auxiliary spares; Weifang and Ningbo warehouses.",
    address: "No. 288 Jinqiao Road, Pudong New Area",
    city: "Shanghai",
    postal: "201206",
    phone: "+86 21 5834 6720",
    yearFounded: 2014,
    website: "https://oceanspareparts.cn",
    email: "export@oceanspareparts.cn",
    commissioner: "Zhang Hong",
    director: "Li Wei",
    picName: "Li Wei",
    picRole: "Export Director",
    picPhone: "+86 138 1766 6720",
    picEmail: "liwei@oceanspareparts.cn",
    soechiReference: "PT Soechi Lines — Technical Procurement",
    paymentTerm: "agent",
    banks: [
      {
        // Banks offshore: a CNY account held at Bank of China's **Singapore** branch. This is the
        // one seeded account where the bank's country differs from the vendor's, which is what makes
        // the M3.2 out-of-country **remark** invariant visible in UAT — and it exercises CNY
        // (SEED-4) at the same time. Offshore CNY settlement out of Singapore is ordinary practice.
        key: "primary",
        bankName: "Bank of China",
        accountNo: "6217-8899-2014-0288",
        holderName: "Ocean Spare Parts Co., Ltd",
        branch: "Singapore Branch",
        description: "Offshore CNY settlement account",
        swift: "BKCHSGSG",
        bankCountryIso3: "SGP",
        currencyCodes: ["CNY", "USD"],
        isPrimary: true,
        holderSameAsCompany: true,
        differsFromCompanyRemark:
          "Offshore CNY settlement is handled through the Singapore branch; the company is registered in China.",
      },
    ],
    // Partial uploads only — the point of a resumable Draft (§2.3).
    documents: { kind: "partial", docNos: ["DOC-000", "DOC-008", "DOC-011"] },
    documentsIssuedDaysAgo: 90,
  },
  {
    slug: "pelabuhan",
    name: "PT Pelabuhan Agen Nusantara",
    ownerEmail: "owner+pelabuhan@vendor.test",
    ownerName: "Fitri Andayani",
    ownerLocale: "id",
    origin: "local",
    source: "office",
    status: "inactive",
    shortCode: "PAN0008",
    // The matrix calls this a "Port Agent"; M2.3 shipped no such category. See VENDOR_SEED's docs.
    categoryNameEn: "Logistics / Freight",
    businessEntityNameEn: "PT (Limited Company)",
    countryIso3: "IDN",
    taxId: "08.901.234.5-058.000",
    taxStatus: "pkp_corporate",
    npwpType: "head_office",
    companyScale: "menengah",
    procurementNote: "Keagenan kapal dan clearance di Tanjung Priok, Panjang, dan Balikpapan.",
    address: "Jl. Raya Pelabuhan No. 5, Tanjung Priok",
    city: "Jakarta Utara",
    postal: "14310",
    phone: "+62 21 4390 058",
    fax: "+62 21 4390 059",
    yearFounded: 2007,
    website: "https://pelabuhanagen.co.id",
    email: "agency@pelabuhanagen.co.id",
    commissioner: "Rudi Hartanto",
    director: "Fitri Andayani",
    picName: "Fitri Andayani",
    picRole: "Direktur Operasional",
    picPhone: "+62 812 8877 058",
    picEmail: "fitri@pelabuhanagen.co.id",
    soechiReference: "PT Soechi Lines — Port Operations",
    paymentTerm: "credit_45",
    inactiveReason:
      "Kontrak keagenan berakhir 31 Desember 2025 dan belum diperpanjang. Vendor dinonaktifkan sementara sampai penunjukan baru.",
    banks: [
      {
        key: "primary",
        bankName: "Bank Rakyat Indonesia (BRI)",
        accountNo: "0058-01-000123-30-7",
        holderName: "PT Pelabuhan Agen Nusantara",
        branch: "KCP Tanjung Priok",
        description: "Rekening keagenan (dorman)",
        bankCountryIso3: "IDN",
        currencyCodes: ["IDR"],
        isPrimary: true,
        holderSameAsCompany: true,
      },
    ],
    // Was Active before being taken out of service, so its documents remain Verified — a
    // reactivation reviews a vendor whose paperwork was already good, not a fresh registration.
    documents: { kind: "verified" },
    documentOverrides: {
      "DOC-001": { refNo: "NIB 8120100582007" },
      "DOC-004": { refNo: "No. 19 tanggal 12 Maret 2007", variant: "Pendirian" },
    },
    documentsIssuedDaysAgo: 500,
  },
];

/* ── §4 In-flight artefacts ──────────────────────────────────────────────────────────────────── */

/** One step of a seeded in-flight request — decided (with who and when) or waiting. */
export type InFlightStepSeed = {
  readonly stepNo: number;
  /** Role `code` — must equal the seeded route's step role, or the request is un-actionable. */
  readonly roleCode: string;
  readonly decision: "pending" | "approved";
  /** Staff email that decided it (approved steps) or holds it (pending steps → the assignee). */
  readonly actorEmail: string;
  /** When it was decided, in days from {@link SEED_DATE}. Approved steps only. */
  readonly decidedDaysAgo?: number;
  readonly note?: string;
};

/** One pending ApprovalRequest, staged mid-route so a Phase-0 queue is non-empty on first login. */
export type InFlightSeed = {
  readonly vendorSlug: string;
  readonly trigger:
    | "new_vendor_registration"
    | "office_vendor_registration"
    | "bank_change"
    | "non_bank_change"
    | "reactivation";
  /** Who submitted it: a vendor owner's slug (`vendor:<slug>`) or a staff email. */
  readonly submittedBy:
    | { readonly kind: "owner"; readonly slug: string }
    | { readonly kind: "staff"; readonly email: string };
  readonly submittedDaysAgo: number;
  readonly currentStepNo: number;
  readonly steps: readonly InFlightStepSeed[];
  /** The proposed diff (edit triggers) or Draft snapshot (registration) — ADR-0005. */
  readonly payload?: Readonly<Record<string, unknown>>;
};

/**
 * The staged in-flight set (seed-matrix §4) — exactly one recognisable item per Phase-0 queue, so no
 * tester's first login opens onto an empty list they can't tell from a broken one.
 *
 * Three requests, three different vendors: `approval_requests_one_pending_per_vendor_uq` allows only
 * one pending request per vendor, and honouring that here is not merely index-appeasement — it is the
 * ADR-0010 rule that a vendor has at most one change in flight.
 *
 * **Reactivation is deliberately absent.** The matrix stages vendor 8 as *eligible to submit* one, not
 * as having submitted — the tester initiates it (§5.8). Seeding the request would consume the very
 * step the golden path asks them to walk.
 */
export const IN_FLIGHT_SEED: readonly InFlightSeed[] = [
  {
    // Approvals queue: mid-route, waiting on AP Supervisor (§4).
    vendorSlug: "chandler",
    trigger: "new_vendor_registration",
    submittedBy: { kind: "owner", slug: "chandler" },
    submittedDaysAgo: 6,
    currentStepNo: 2,
    steps: [
      {
        stepNo: 1,
        roleCode: "ap_staff",
        decision: "approved",
        actorEmail: "apstaff@vms.test",
        decidedDaysAgo: 4,
        note: "Profil dan rekening sudah sesuai. Diteruskan ke supervisor.",
      },
      // SoD holds: the submitter is the vendor's own owner, and step 1 was decided by AP Staff —
      // neither is `apsuper`, so the step is genuinely actionable by the account the matrix names.
      // Nor has anyone verified this vendor's documents yet (they are Pending), so the M4.3
      // verifier-conflict rule has nothing to trip on.
      { stepNo: 2, roleCode: "ap_supervisor", decision: "pending", actorEmail: "apsuper@vms.test" },
    ],
  },
  {
    // HOD activation queue (§4). An office registration is raised by AP Staff on the vendor's
    // behalf, so the submitter is staff — not the owner, who has not logged in yet.
    vendorSlug: "galangan",
    trigger: "office_vendor_registration",
    submittedBy: { kind: "staff", email: "apstaff@vms.test" },
    submittedDaysAgo: 3,
    currentStepNo: 1,
    steps: [{ stepNo: 1, roleCode: "hod", decision: "pending", actorEmail: "hod@vms.test" }],
  },
  {
    // Post-activation edit (§4): vendor 1 wants a second bank account. The vendor **stays Active**
    // and the new account does not exist yet — the proposal lives in `payload` and is applied only
    // on final approval (ADR-0010), with `vendors.change_pending` flagged meanwhile. Seeding the
    // second `vendor_banks` row would be wrong: it would mean the change had already landed.
    vendorSlug: "bahari",
    trigger: "bank_change",
    submittedBy: { kind: "owner", slug: "bahari" },
    submittedDaysAgo: 2,
    currentStepNo: 2,
    steps: [
      {
        stepNo: 1,
        roleCode: "ap_staff",
        decision: "approved",
        actorEmail: "apstaff@vms.test",
        decidedDaysAgo: 1,
        note: "Bukti rekening terlampir dan cocok dengan nama perusahaan.",
      },
      { stepNo: 2, roleCode: "ap_manager", decision: "pending", actorEmail: "apmanager@vms.test" },
    ],
    payload: {
      change: "add_bank",
      bank: {
        bankName: "Bank Mandiri",
        accountNo: "1220098877665",
        holderName: "PT Bahari Bunker Nusantara",
        branch: "KCP Cilincing",
        description: "Rekening penerimaan pembayaran USD",
        currencyCodes: ["IDR", "USD"],
        isPrimary: false,
        holderSameAsCompany: true,
      },
    },
  },
];
