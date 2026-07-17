/**
 * UAT scenario loader (#88) — turns the [009 seed-matrix] fixtures into rows, files and queues.
 *
 * `@vms/db`'s seeds load the *reference* data the schema needs to function (roles, masters, routes).
 * This loads the *scenario* played out on top of it: the accounts a tester logs in as, the eight-vendor
 * roster, and the in-flight approvals that make every Phase-0 queue non-empty on first login.
 *
 * ## Why this lives in `apps/api` and not beside the other seeds
 *
 * Because it is the only seed made of **domain** data, and every part of it has to agree with a rule
 * that already exists somewhere in this app. Put it in `@vms/db` — which is deliberately domain-free —
 * and each of those agreements becomes a copy that can drift:
 *
 * - **Credentials** must hash the way better-auth hashes, or no seeded account can log in.
 * - **The activation gate.** An Active vendor's documents have to satisfy `requiredDocumentSet`
 *   (`@vms/domain`) — the *same* composition M5.2 runs at the `activate` effect. Re-deriving
 *   "which docs are mandatory" here would mean a seeded vendor could be Active while the gate that
 *   guards activation disagrees, and nothing would catch it.
 * - **Files** must land through the M3.2 storage seam (`../storage`), in the bucket the API presigns
 *   reads from.
 *
 * `@vms/db` can reach none of those without growing a dependency on `better-auth`, `@vms/domain` and an
 * S3 client — i.e. without becoming `apps/api`. So the seam lands where the knowledge already is, and
 * `seedAccess()` is still built on rather than replaced: this reads the roles it seeded, by `code`.
 *
 * ## Idempotency
 *
 * Re-runnable on every `docker compose up`. Every row is upserted on a stable key — a natural unique
 * index where the schema has one (`users.email`, `document_slots(vendor, master)`), and otherwise a
 * primary key derived from a business key via {@link seedUuid}, because most of these tables have no
 * natural key to speak of. Object storage is content-stable too: the placeholder PDFs are generated
 * deterministically and written to fixed keys, so a re-run overwrites bytes rather than orphaning them.
 *
 * One caveat, stated rather than hidden: the credential hash is re-minted per run (scrypt salts every
 * hash), so the stored value differs byte-wise between runs while the password it accepts is identical.
 * A tester who changes a seeded account's password will find it reset on the next `up` — the seed's
 * contract is that these accounts have {@link SEED_PASSWORD}.
 *
 * ## What it deliberately does not seed
 *
 * - **`newvendor@example.com`** — the tester's live signup + Mailpit verify path (matrix §1.3).
 * - **Vendor 8's reactivation request** — the tester submits it; seeding it would consume the step.
 * - **Audit rows.** The seeded vendors have no history because nothing happened to them: they were
 *   loaded, not worked. An audit log is an evidentiary record (ADR-0011), and filling one with
 *   plausible fictions of decisions nobody made is worse than an empty Activity tab that is merely
 *   uninformative. Real trails appear the moment a tester touches anything.
 * - **Invoicing / PO / reports data** — those pillars ship as "coming soon" shells (matrix §6).
 */

import {
  type DB,
  approvalRequestSteps,
  approvalRequests,
  approvalRouteSteps,
  approvalRoutes,
  authAccounts,
  banks,
  businessEntities,
  categoryDocumentRequirements,
  countries,
  currencies,
  db as defaultDb,
  documentMaster,
  documentSlots,
  documentVersions,
  files,
  roles,
  userRoles,
  users,
  vendorBankCurrencies,
  vendorBanks,
  vendorCategories,
  vendorSubUsers,
  vendors,
} from "@vms/db";
import type { CategoryDocumentRule, DocumentMasterRule } from "@vms/domain";
import { requiredDocumentSet } from "@vms/domain";
import { hashPassword } from "better-auth/crypto";
import { and, eq, notInArray } from "drizzle-orm";
import { type FileStore, bunS3FileStore, validateAttachment } from "../storage";
import {
  IN_FLIGHT_SEED,
  SEED_PASSWORD,
  STAFF_SEED,
  VENDOR_SEED,
  type VendorSeed,
  seedDay,
  seedInstant,
  seedUuid,
} from "./fixtures";
import { placeholderPdf } from "./pdf";

/** Everything the loader resolves once up-front: master rows, by the natural keys the fixtures name. */
type MasterIndex = {
  readonly countryByIso3: ReadonlyMap<string, string>;
  readonly bankByName: ReadonlyMap<string, string>;
  readonly currencyByCode: ReadonlyMap<string, string>;
  readonly categoryByNameEn: ReadonlyMap<string, string>;
  readonly entityByNameEn: ReadonlyMap<string, string>;
  readonly docByNo: ReadonlyMap<string, DocRow>;
  readonly docById: ReadonlyMap<string, DocRow>;
  readonly masterRules: readonly DocumentMasterRule[];
  readonly categoryRules: readonly CategoryDocumentRule[];
  readonly roleByCode: ReadonlyMap<string, string>;
  readonly routeByTrigger: ReadonlyMap<string, RouteRow>;
};

type DocRow = {
  readonly id: string;
  readonly no: string;
  readonly nameEn: string;
  readonly validityDays: number;
};
type RouteRow = { readonly id: string; readonly stepRoleByNo: ReadonlyMap<number, string> };

/** What the loader wrote, for the container log. */
export type ScenarioCounts = {
  accounts: number;
  vendors: number;
  banks: number;
  documents: number;
  filesStored: number;
  requests: number;
};

/**
 * Look a natural key up, or fail loudly naming what was missing. Every one of these resolves a row
 * some *other* seed owns, so a miss means the seeds ran out of order or a master list changed under
 * the fixtures — both of which should stop the boot with a legible message rather than write a null FK
 * and surface later as an empty dropdown nobody can explain.
 */
const resolve = <T>(map: ReadonlyMap<string, T>, key: string, what: string): T => {
  const found = map.get(key);
  if (found === undefined)
    throw new Error(
      `[seed-scenario] no ${what} named "${key}" — is @vms/db's master seed up to date with the fixtures?`,
    );
  return found;
};

/* ── Master-data resolution ──────────────────────────────────────────────────────────────────── */

const loadMasterIndex = async (db: DB): Promise<MasterIndex> => {
  const [countryRows, bankRows, currencyRows, categoryRows, entityRows, docRows, roleRows] =
    await Promise.all([
      db.select({ id: countries.id, iso3: countries.iso3 }).from(countries),
      db.select({ id: banks.id, name: banks.name }).from(banks),
      db.select({ id: currencies.id, code: currencies.code }).from(currencies),
      db
        .select({ id: vendorCategories.id, nameEn: vendorCategories.nameEn })
        .from(vendorCategories),
      db
        .select({ id: businessEntities.id, nameEn: businessEntities.nameEn })
        .from(businessEntities),
      db
        .select({
          id: documentMaster.id,
          no: documentMaster.no,
          nameEn: documentMaster.nameEn,
          validityDays: documentMaster.validityDays,
          appliesTo: documentMaster.appliesTo,
          mandatory: documentMaster.mandatory,
          enabled: documentMaster.enabled,
        })
        .from(documentMaster),
      db.select({ id: roles.id, code: roles.code }).from(roles),
    ]);

  // The category requirement rows carry their own `active` flag; `enabled` belongs to the referenced
  // document_master row — hence the join (that's the shape `requiredDocumentSet` reads).
  const requirementRows = await db
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
      eq(documentMaster.id, categoryDocumentRequirements.documentMasterId),
    );

  const routeRows = await db
    .select({ id: approvalRoutes.id, trigger: approvalRoutes.trigger })
    .from(approvalRoutes);
  const routeStepRows = await db
    .select({
      routeId: approvalRouteSteps.routeId,
      stepNo: approvalRouteSteps.stepNo,
      roleId: approvalRouteSteps.roleId,
    })
    .from(approvalRouteSteps);

  const docs: DocRow[] = docRows.map((d) => ({
    id: d.id,
    no: d.no,
    nameEn: d.nameEn,
    validityDays: d.validityDays,
  }));

  return {
    countryByIso3: new Map(countryRows.map((r) => [r.iso3, r.id])),
    bankByName: new Map(bankRows.map((r) => [r.name, r.id])),
    currencyByCode: new Map(currencyRows.map((r) => [r.code, r.id])),
    categoryByNameEn: new Map(categoryRows.map((r) => [r.nameEn, r.id])),
    entityByNameEn: new Map(entityRows.map((r) => [r.nameEn, r.id])),
    docByNo: new Map(docs.map((d) => [d.no, d])),
    docById: new Map(docs.map((d) => [d.id, d])),
    masterRules: docRows.map((d) => ({
      id: d.id,
      appliesTo: d.appliesTo,
      mandatory: d.mandatory,
      enabled: d.enabled,
    })),
    categoryRules: requirementRows,
    roleByCode: new Map(roleRows.map((r) => [r.code, r.id])),
    routeByTrigger: new Map(
      routeRows.map((r) => [
        r.trigger,
        {
          id: r.id,
          stepRoleByNo: new Map(
            routeStepRows.filter((s) => s.routeId === r.id).map((s) => [s.stepNo, s.roleId]),
          ),
        },
      ]),
    ),
  };
};

/* ── §1 Accounts ─────────────────────────────────────────────────────────────────────────────── */

/**
 * Write one account: the `users` row, its better-auth credential, and (for staff) its role grant.
 *
 * The credential is written **as a row** rather than through `auth.api.signUpEmail`, because sign-up is
 * the wrong shape for a fixture in three ways: it forces `kind = "vendor"` (so no staff account could
 * ever be created through it), it mails a verification link per account (14 of them, into Mailpit, on
 * every boot — burying the one verification mail the tester actually needs), and it cannot pre-set
 * `emailVerified`, which is the whole point of a seeded login.
 *
 * The coupling that buys: this must agree with `auth.ts`'s `emailAndPassword` hashing, which is
 * better-auth's default scrypt. `hashPassword` is that default, imported from better-auth's own public
 * `crypto` entrypoint — so the two agree by construction today. Configure a custom `password.hash` in
 * `auth.ts` and this must follow, or every seeded login breaks at once (loudly, on first sign-in).
 */
const upsertAccount = async (
  db: DB,
  account: {
    readonly email: string;
    readonly name: string;
    readonly kind: "internal" | "vendor";
    readonly locale: "id" | "en";
    readonly passwordHash: string;
  },
): Promise<string> => {
  const [row] = await db
    .insert(users)
    .values({
      id: seedUuid(`user:${account.email}`),
      kind: account.kind,
      email: account.email,
      emailVerified: true, // seeded logins skip the verify step (matrix §1.1/§1.2)
      name: account.name,
      locale: account.locale,
      active: true,
    })
    // Conflict on the email, not the id: if an account with this address already exists under some
    // other id (a hand-made test user, the dev-actor), we must adopt *its* id rather than fail — so
    // the id is read back from the write rather than assumed.
    .onConflictDoUpdate({
      target: users.email,
      set: {
        kind: account.kind,
        name: account.name,
        emailVerified: true,
        locale: account.locale,
        active: true,
        updatedAt: new Date(),
      },
    })
    .returning({ id: users.id });
  if (!row) throw new Error(`[seed-scenario] user upsert returned no row: ${account.email}`);

  // `auth_accounts` has no unique index to upsert on, so the credential is reconciled by hand.
  const [existing] = await db
    .select({ id: authAccounts.id })
    .from(authAccounts)
    .where(and(eq(authAccounts.userId, row.id), eq(authAccounts.providerId, "credential")))
    .limit(1);
  if (existing) {
    await db
      .update(authAccounts)
      .set({ passwordHash: account.passwordHash, updatedAt: new Date() })
      .where(eq(authAccounts.id, existing.id));
  } else {
    await db.insert(authAccounts).values({
      userId: row.id,
      providerId: "credential",
      // better-auth's own convention for a credential account (see its sign-up route): the account
      // id *is* the user id. Sign-in looks the row up by providerId and reads `password` off it.
      accountId: row.id,
      passwordHash: account.passwordHash,
    });
  }

  return row.id;
};

/** Grant `userId` the role `roleCode` holds. Idempotent via the `(user, role)` unique index. */
const setRoles = async (db: DB, userId: string, roleIds: readonly string[]): Promise<void> => {
  for (const roleId of roleIds) {
    await db.insert(userRoles).values({ userId, roleId }).onConflictDoNothing();
  }
  // Reconcile, don't just add. A seeded account's grants must be *exactly* what the fixture says, and
  // the difference is not cosmetic: the whole SoD story depends on one hat per account. Because
  // accounts are adopted by email, this account may predate the seed — and it did in practice, which
  // is how this was found: `apstaff@vms.test` already existed holding `ap_manager` from an earlier
  // session's manual testing, so a plain insert left AP Staff *also* an AP Manager, quietly able to
  // decide the very bank-change step the scenario stages for someone else.
  //
  // It also keeps the seed on the right side of #96: an owner adopted from an old test run cannot
  // keep a staff role it should never have held, because vendor owners reconcile to `vendor` alone.
  await db
    .delete(userRoles)
    .where(and(eq(userRoles.userId, userId), notInArray(userRoles.roleId, [...roleIds])));
};

/**
 * Seed the §1 accounts: six staff logins + one owner per vendor, their role grants, and each staff
 * role's `lead_user_id`.
 *
 * The leads are the part that matters beyond logging in. ADR-0012 auto-dispatches a newly opened step
 * to its role's lead; with `roles.lead_user_id` never seeded, M4.2 has been assigning every step to
 * `null` since #57 — a queue belonging to nobody. Wiring them here is what closes that gap.
 *
 * Owners hold the `vendor` role and nothing else. That is not a detail: staff roles must only ever
 * reach internal-kind users (see #96 — the API's own role-grant route does not yet enforce it), and a
 * seed that broke the rule would be a live counter-example sitting in every UAT database. Which is why
 * grants are *reconciled* rather than added — see {@link setRoles}.
 */
const seedAccounts = async (db: DB, master: MasterIndex): Promise<Map<string, string>> => {
  const userIdByEmail = new Map<string, string>();

  for (const staff of STAFF_SEED) {
    const passwordHash = await hashPassword(SEED_PASSWORD);
    const userId = await upsertAccount(db, {
      email: staff.email,
      name: staff.name,
      kind: "internal",
      locale: "id",
      passwordHash,
    });
    const roleId = resolve(master.roleByCode, staff.roleCode, "role");
    await setRoles(db, userId, [roleId]);
    // Each staff account is its role's lead (ADR-0012) — the auto-dispatch target for a new step.
    await db
      .update(roles)
      .set({ leadUserId: userId, updatedAt: new Date() })
      .where(eq(roles.id, roleId));
    userIdByEmail.set(staff.email, userId);
  }

  const vendorRoleId = resolve(master.roleByCode, "vendor", "role");
  for (const vendor of VENDOR_SEED) {
    const passwordHash = await hashPassword(SEED_PASSWORD);
    const userId = await upsertAccount(db, {
      email: vendor.ownerEmail,
      name: vendor.ownerName,
      kind: "vendor",
      locale: vendor.ownerLocale,
      passwordHash,
    });
    await setRoles(db, userId, [vendorRoleId]);
    userIdByEmail.set(vendor.ownerEmail, userId);
  }

  return userIdByEmail;
};

/* ── Files ───────────────────────────────────────────────────────────────────────────────────── */

/** A placeholder PDF's fixed identity: a stable `files.id`, a recognisable key, deterministic bytes. */
const storePlaceholder = async (
  db: DB,
  store: FileStore,
  input: {
    readonly name: string; // e.g. "bahari-npwp.pdf" — the recognisable filename (matrix §0)
    readonly title: string;
    readonly lines: readonly string[];
    readonly uploadedBy: string;
  },
): Promise<string> => {
  const bytes = placeholderPdf(input.title, input.lines);
  // Hold the fixtures to the same bar a real upload clears (M3.2) — if a generated placeholder would
  // be rejected at the route, it has no business in the database either.
  const invalid = validateAttachment("application/pdf", bytes.byteLength);
  if (invalid) throw new Error(`[seed-scenario] placeholder ${input.name} is not a valid upload`);

  // Fixed key, not `randomUUID()` as the upload path mints: a re-run must overwrite this object, not
  // strand the last one. `seed/` namespaces the fixtures away from real uploads.
  const objectKey = `seed/${input.name}`;
  await store.put(objectKey, bytes, "application/pdf");

  const id = seedUuid(`file:${objectKey}`);
  await db
    .insert(files)
    .values({
      id,
      bucket: store.bucket,
      objectKey,
      mime: "application/pdf",
      sizeBytes: bytes.byteLength,
      originalName: input.name,
      uploadedBy: input.uploadedBy,
    })
    .onConflictDoUpdate({
      target: files.id,
      set: { sizeBytes: bytes.byteLength, objectKey, updatedAt: new Date() },
    });
  return id;
};

/* ── §2 Vendor roster ────────────────────────────────────────────────────────────────────────── */

/** Which documents a vendor holds and in what verify state — {@link DocumentPlan} made concrete. */
type PlannedDocument = {
  readonly masterId: string;
  readonly verifyStatus: "pending" | "verified" | "rejected";
  readonly rejectReason?: string;
};

/**
 * Expand a vendor's {@link DocumentPlan} against the required set the **activation gate** will compute
 * (`requiredDocumentSet`, `@vms/domain`) — not against a list restated here. That is the point of the
 * whole module living in `apps/api`: an Active seeded vendor satisfies M5.2 because it was built from
 * M5.2's own composition, so the two cannot drift into a vendor that is Active but un-activatable.
 */
const planDocuments = (
  vendor: VendorSeed,
  requiredIds: readonly string[],
  master: MasterIndex,
): readonly PlannedDocument[] => {
  const plan = vendor.documents;
  switch (plan.kind) {
    case "verified":
      return requiredIds.map((masterId) => ({ masterId, verifyStatus: "verified" as const }));
    case "pending":
      return requiredIds.map((masterId) => ({ masterId, verifyStatus: "pending" as const }));
    case "rejected": {
      const rejected = resolve(master.docByNo, plan.docNo, "document master").id;
      if (!requiredIds.includes(rejected))
        throw new Error(
          `[seed-scenario] ${vendor.slug}: ${plan.docNo} is rejected but is not in its required set — the fixture's story (rejected doc pushed the vendor back to Draft) no longer holds.`,
        );
      return requiredIds.map((masterId) =>
        masterId === rejected
          ? { masterId, verifyStatus: "rejected" as const, rejectReason: plan.reason }
          : { masterId, verifyStatus: "verified" as const },
      );
    }
    case "partial": {
      return plan.docNos.map((no) => {
        const masterId = resolve(master.docByNo, no, "document master").id;
        if (!requiredIds.includes(masterId))
          throw new Error(
            `[seed-scenario] ${vendor.slug}: partial upload ${no} is not in its required set.`,
          );
        return { masterId, verifyStatus: "pending" as const };
      });
    }
  }
};

/** The certificate number printed beside an upload (matrix §2.1) — the NPWP *is* the vendor's tax id. */
const refNoFor = (vendor: VendorSeed, doc: DocRow): string | null => {
  const override = vendor.documentOverrides?.[doc.no];
  if (override?.refNo) return override.refNo;
  if (doc.no === "DOC-002") return vendor.taxId ?? null; // NPWP
  return `${doc.no}/${vendor.slug.toUpperCase()}/${seedInstant(-vendor.documentsIssuedDaysAgo).getUTCFullYear()}`;
};

/** Write a vendor's bank accounts, their currencies, and the attachments each invariant demands. */
const seedBanks = async (
  db: DB,
  store: FileStore,
  vendor: VendorSeed,
  vendorId: string,
  ownerUserId: string,
  master: MasterIndex,
): Promise<number> => {
  let stored = 0;
  for (const bank of vendor.banks) {
    const bankRowId = seedUuid(`bank:${vendor.slug}:${bank.key}`);

    // Every account carries its passbook/statement proof; an account not in the company's name also
    // needs the holder's KTP + a Surat Pernyataan (the M3.2 holder-proof invariant, ADR-0007).
    const proofFileId = await storePlaceholder(db, store, {
      name: `${vendor.slug}-bank-proof.pdf`,
      title: "Bank Account Proof",
      lines: [
        `Vendor: ${vendor.name}`,
        `Bank: ${bank.bankName} — ${bank.branch}`,
        `Account no: ${bank.accountNo}`,
        `Account holder: ${bank.holderName}`,
      ],
      uploadedBy: ownerUserId,
    });
    stored += 1;

    let ktpFileId: string | null = null;
    let suratFileId: string | null = null;
    if (!bank.holderSameAsCompany) {
      ktpFileId = await storePlaceholder(db, store, {
        name: `${vendor.slug}-ktp.pdf`,
        title: "KTP Pemilik Rekening",
        lines: [`Nama: ${bank.holderName}`, `Vendor: ${vendor.name}`],
        uploadedBy: ownerUserId,
      });
      suratFileId = await storePlaceholder(db, store, {
        name: `${vendor.slug}-surat-pernyataan.pdf`,
        title: "Surat Pernyataan Rekening",
        lines: [
          `Pemegang rekening: ${bank.holderName}`,
          `Menyatakan rekening ${bank.accountNo} digunakan untuk dan atas nama ${vendor.name}.`,
        ],
        uploadedBy: ownerUserId,
      });
      stored += 2;
    }

    await db
      .insert(vendorBanks)
      .values({
        id: bankRowId,
        vendorId,
        bankId: resolve(master.bankByName, bank.bankName, "bank"),
        bankName: bank.bankName,
        accountNo: bank.accountNo,
        holderName: bank.holderName,
        branch: bank.branch,
        description: bank.description ?? null,
        swift: bank.swift ?? null,
        bankCountryId: resolve(master.countryByIso3, bank.bankCountryIso3, "country"),
        isPrimary: bank.isPrimary,
        holderSameAsCompany: bank.holderSameAsCompany,
        differsFromCompanyRemark: bank.differsFromCompanyRemark ?? null,
        proofFileId,
        ktpFileId,
        suratPernyataanFileId: suratFileId,
      })
      .onConflictDoUpdate({
        target: vendorBanks.id,
        set: {
          accountNo: bank.accountNo,
          holderName: bank.holderName,
          branch: bank.branch,
          description: bank.description ?? null,
          isPrimary: bank.isPrimary,
          holderSameAsCompany: bank.holderSameAsCompany,
          differsFromCompanyRemark: bank.differsFromCompanyRemark ?? null,
          proofFileId,
          ktpFileId,
          suratPernyataanFileId: suratFileId,
          updatedAt: new Date(),
        },
      });

    // Replace the M:N currency set wholesale — the same shape the M3.2 update route uses, and the
    // only way a re-run after a fixture edit drops a currency rather than accumulating it.
    await db.delete(vendorBankCurrencies).where(eq(vendorBankCurrencies.vendorBankId, bankRowId));
    for (const code of bank.currencyCodes) {
      await db.insert(vendorBankCurrencies).values({
        vendorBankId: bankRowId,
        currencyId: resolve(master.currencyByCode, code, "currency"),
      });
    }
  }
  return stored;
};

/** Write a vendor's document slots + their current versions, staged in the plan's verify state. */
const seedDocuments = async (
  db: DB,
  store: FileStore,
  vendor: VendorSeed,
  vendorId: string,
  ownerUserId: string,
  verifierUserId: string,
  master: MasterIndex,
): Promise<{ documents: number; filesStored: number }> => {
  const requiredIds = requiredDocumentSet(
    {
      origin: vendor.origin,
      categoryId: resolve(master.categoryByNameEn, vendor.categoryNameEn, "category"),
    },
    { master: master.masterRules, categoryRequirements: master.categoryRules },
  );
  const planned = planDocuments(vendor, requiredIds, master);

  let filesStored = 0;
  for (const doc of planned) {
    const row = resolve(master.docById, doc.masterId, "document master");
    const issuedOn = seedDay(-vendor.documentsIssuedDaysAgo);
    // A validity of 0 means the certificate does not expire (M2.3) — leave the date null rather than
    // invent one, so the expiry column reads as "n/a" instead of a date nobody can explain.
    const expiresOn =
      row.validityDays > 0 ? seedDay(-vendor.documentsIssuedDaysAgo + row.validityDays) : null;

    const fileId = await storePlaceholder(db, store, {
      name: `${vendor.slug}-${row.no.toLowerCase()}.pdf`,
      title: row.nameEn,
      lines: [
        `Vendor: ${vendor.name}`,
        `Document: ${row.no} — ${row.nameEn}`,
        `Reference no: ${refNoFor(vendor, row) ?? "-"}`,
        `Issued on: ${issuedOn}`,
        `Valid until: ${expiresOn ?? "no expiry"}`,
      ],
      uploadedBy: ownerUserId,
    });
    filesStored += 1;

    const [slot] = await db
      .insert(documentSlots)
      .values({ vendorId, documentMasterId: doc.masterId })
      .onConflictDoUpdate({
        target: [documentSlots.vendorId, documentSlots.documentMasterId],
        set: { updatedAt: new Date() },
      })
      .returning({ id: documentSlots.id });
    if (!slot)
      throw new Error(`[seed-scenario] slot upsert returned no row: ${vendor.slug}/${row.no}`);

    const decided = doc.verifyStatus !== "pending";
    const [version] = await db
      .insert(documentVersions)
      .values({
        slotId: slot.id,
        versionNo: 1,
        fileId,
        refNo: refNoFor(vendor, row),
        variant: vendor.documentOverrides?.[row.no]?.variant ?? null,
        issuedOn,
        expiresOn,
        verifyStatus: doc.verifyStatus,
        verifiedBy: decided ? verifierUserId : null,
        verifiedAt: decided ? seedInstant(-5) : null,
        rejectReason: doc.rejectReason ?? null,
        uploadedBy: ownerUserId,
      })
      .onConflictDoUpdate({
        target: [documentVersions.slotId, documentVersions.versionNo],
        set: {
          fileId,
          refNo: refNoFor(vendor, row),
          variant: vendor.documentOverrides?.[row.no]?.variant ?? null,
          issuedOn,
          expiresOn,
          verifyStatus: doc.verifyStatus,
          verifiedBy: decided ? verifierUserId : null,
          verifiedAt: decided ? seedInstant(-5) : null,
          rejectReason: doc.rejectReason ?? null,
          updatedAt: new Date(),
        },
      })
      .returning({ id: documentVersions.id });
    if (!version)
      throw new Error(`[seed-scenario] version upsert returned no row: ${vendor.slug}/${row.no}`);

    await db
      .update(documentSlots)
      .set({ currentVersionId: version.id, updatedAt: new Date() })
      .where(eq(documentSlots.id, slot.id));
  }

  return { documents: planned.length, filesStored };
};

/** Write the roster: vendor rows, owner links, banks, documents. */
const seedVendors = async (
  db: DB,
  store: FileStore,
  userIdByEmail: ReadonlyMap<string, string>,
  master: MasterIndex,
): Promise<{ vendors: number; banks: number; documents: number; filesStored: number }> => {
  const verifierUserId = resolve(userIdByEmail, "verifier@vms.test", "seeded user");
  // An Active vendor with a post-activation edit in flight stays Active and flies the flag instead
  // (ADR-0010) — derived from the in-flight set so the two can't disagree about which vendor that is.
  const changePendingSlugs = new Set(
    IN_FLIGHT_SEED.filter(
      (r) => r.trigger === "bank_change" || r.trigger === "non_bank_change",
    ).map((r) => r.vendorSlug),
  );

  const counts = { vendors: 0, banks: 0, documents: 0, filesStored: 0 };
  for (const vendor of VENDOR_SEED) {
    const vendorId = seedUuid(`vendor:${vendor.slug}`);
    const ownerUserId = resolve(userIdByEmail, vendor.ownerEmail, "seeded user");

    const values = {
      id: vendorId,
      origin: vendor.origin,
      status: vendor.status,
      source: vendor.source,
      shortCode: vendor.shortCode ?? null,
      name: vendor.name,
      businessEntityId: resolve(
        master.entityByNameEn,
        vendor.businessEntityNameEn,
        "business entity",
      ),
      categoryId: resolve(master.categoryByNameEn, vendor.categoryNameEn, "category"),
      taxId: vendor.taxId ?? null,
      taxStatus: vendor.taxStatus ?? null,
      npwpType: vendor.npwpType ?? null,
      companyScale: vendor.companyScale ?? null,
      procurementNote: vendor.procurementNote ?? null,
      address: vendor.address,
      city: vendor.city,
      postal: vendor.postal,
      countryId: resolve(master.countryByIso3, vendor.countryIso3, "country"),
      phone: vendor.phone,
      fax: vendor.fax ?? null,
      yearFounded: vendor.yearFounded,
      website: vendor.website,
      email: vendor.email,
      commissioner: vendor.commissioner,
      director: vendor.director,
      picName: vendor.picName,
      picRole: vendor.picRole,
      picPhone: vendor.picPhone,
      picEmail: vendor.picEmail,
      soechiReference: vendor.soechiReference,
      paymentTerm: vendor.paymentTerm,
      changePending: changePendingSlugs.has(vendor.slug),
      inactiveReason: vendor.inactiveReason ?? null,
    };

    await db
      .insert(vendors)
      .values(values)
      .onConflictDoUpdate({ target: vendors.id, set: { ...values, updatedAt: new Date() } });
    counts.vendors += 1;

    await db
      .insert(vendorSubUsers)
      .values({ vendorId, userId: ownerUserId, isOwner: true })
      .onConflictDoUpdate({
        target: [vendorSubUsers.vendorId, vendorSubUsers.userId],
        set: { isOwner: true, updatedAt: new Date() },
      });

    counts.filesStored += await seedBanks(db, store, vendor, vendorId, ownerUserId, master);
    counts.banks += vendor.banks.length;

    const docs = await seedDocuments(
      db,
      store,
      vendor,
      vendorId,
      ownerUserId,
      verifierUserId,
      master,
    );
    counts.documents += docs.documents;
    counts.filesStored += docs.filesStored;
  }
  return counts;
};

/* ── §4 In-flight artefacts ──────────────────────────────────────────────────────────────────── */

/**
 * Stage the pending approval requests. Each step's role is checked against the **seeded route's** step
 * role before anything is written: a request whose step 2 names a role the route doesn't put there is
 * un-actionable — the console would show a queue item that no account can decide, which is a worse
 * failure than an empty queue because it looks like a permissions bug.
 */
const seedInFlight = async (
  db: DB,
  userIdByEmail: ReadonlyMap<string, string>,
  master: MasterIndex,
): Promise<number> => {
  for (const request of IN_FLIGHT_SEED) {
    const vendor = VENDOR_SEED.find((v) => v.slug === request.vendorSlug);
    if (!vendor)
      throw new Error(
        `[seed-scenario] in-flight request names unknown vendor: ${request.vendorSlug}`,
      );
    const route = resolve(master.routeByTrigger, request.trigger, "approval route");
    const requestId = seedUuid(`request:${request.vendorSlug}:${request.trigger}`);
    const submittedBy =
      request.submittedBy.kind === "owner"
        ? resolve(userIdByEmail, resolveOwnerEmail(request.submittedBy.slug), "seeded user")
        : resolve(userIdByEmail, request.submittedBy.email, "seeded user");

    const values = {
      id: requestId,
      subjectVendorId: seedUuid(`vendor:${request.vendorSlug}`),
      trigger: request.trigger,
      status: "pending" as const,
      payload: request.payload ?? null,
      routeId: route.id,
      currentStepNo: request.currentStepNo,
      submittedBy,
      resolvedAt: null,
      createdAt: seedInstant(-request.submittedDaysAgo),
    };
    await db
      .insert(approvalRequests)
      .values(values)
      .onConflictDoUpdate({
        target: approvalRequests.id,
        set: { ...values, updatedAt: new Date() },
      });

    for (const step of request.steps) {
      const roleId = resolve(master.roleByCode, step.roleCode, "role");
      const routeRoleId = route.stepRoleByNo.get(step.stepNo);
      if (routeRoleId !== roleId)
        throw new Error(
          `[seed-scenario] ${request.vendorSlug}/${request.trigger} step ${step.stepNo} names role "${step.roleCode}", which is not what the seeded route puts at that step — the request would be un-actionable.`,
        );
      const actorId = resolve(userIdByEmail, step.actorEmail, "seeded user");
      const decided = step.decision === "approved";
      const stepValues = {
        requestId,
        stepNo: step.stepNo,
        roleId,
        // A decided step records who decided it; a pending step records who it is waiting on
        // (ADR-0012 auto-dispatch to the role's lead — the same accounts seeded as leads above).
        assigneeUserId: actorId,
        decision: step.decision,
        decidedBy: decided ? actorId : null,
        decidedAt: decided ? seedInstant(-(step.decidedDaysAgo ?? 0)) : null,
        note: step.note ?? null,
        isOverride: false,
      };
      await db
        .insert(approvalRequestSteps)
        .values(stepValues)
        .onConflictDoUpdate({
          target: [approvalRequestSteps.requestId, approvalRequestSteps.stepNo],
          set: { ...stepValues, updatedAt: new Date() },
        });
    }
  }
  return IN_FLIGHT_SEED.length;
};

const resolveOwnerEmail = (slug: string): string => {
  const vendor = VENDOR_SEED.find((v) => v.slug === slug);
  if (!vendor) throw new Error(`[seed-scenario] unknown vendor slug: ${slug}`);
  return vendor.ownerEmail;
};

/* ── Entry ───────────────────────────────────────────────────────────────────────────────────── */

/**
 * Load the whole scenario. Ordered by foreign key: accounts before vendors (owner links, uploader
 * attribution), vendors before their in-flight requests.
 *
 * Not wrapped in a single transaction, deliberately: it writes to MinIO as well as Postgres, and no
 * transaction spans both — a rollback would leave the objects behind anyway. Every step is idempotent
 * instead, so the recovery for a half-finished run is to run it again, which is also what happens on
 * the next `docker compose up`.
 */
export const seedScenario = async (
  db: DB = defaultDb,
  store: FileStore = bunS3FileStore(),
): Promise<ScenarioCounts> => {
  const master = await loadMasterIndex(db);
  const userIdByEmail = await seedAccounts(db, master);
  const roster = await seedVendors(db, store, userIdByEmail, master);
  const requests = await seedInFlight(db, userIdByEmail, master);

  return {
    accounts: userIdByEmail.size,
    vendors: roster.vendors,
    banks: roster.banks,
    documents: roster.documents,
    filesStored: roster.filesStored,
    requests,
  };
};
