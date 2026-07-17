/**
 * Static invariants over the UAT scenario fixtures (#88).
 *
 * These run without a Postgres, a MinIO or a clock, because the scenario is data: everything worth
 * asserting about it is true before a single row is written. The loader's own guards (does this bank
 * name exist in the master list? does this step's role match the seeded route?) are deliberately *not*
 * duplicated here — they need the database to answer and they throw loudly at boot when they fail.
 *
 * What's here is the layer above: the promises the matrix makes about the *shape* of the scenario, and
 * which are exactly the ones a later edit would break silently. Renaming a slug, adding a ninth vendor,
 * moving a doc between plans — none of that fails a typecheck, and the symptom in UAT would be a queue
 * that quietly isn't there rather than an error anyone can trace back.
 *
 * The bank rules in particular are checked with `@vms/domain`'s **own predicates**, not with
 * re-implementations of them. A fixture that satisfied a local copy of the invariant while failing the
 * real one is precisely the bug worth catching, and it would sail past a test that had its own copy.
 */

import { describe, expect, test } from "bun:test";
import { bankCountryRemarkRequired, primaryCount } from "@vms/domain";
import {
  IN_FLIGHT_SEED,
  SEED_DATE,
  STAFF_SEED,
  UNSEEDED_SIGNUP_EMAIL,
  VENDOR_SEED,
  seedDay,
  seedUuid,
} from "./fixtures";
import { placeholderPdf } from "./pdf";

const bySlug = (slug: string) => {
  const vendor = VENDOR_SEED.find((v) => v.slug === slug);
  if (!vendor) throw new Error(`no fixture vendor "${slug}"`);
  return vendor;
};

describe("seed anchors", () => {
  test("dates are offsets from the fixed anchor, not the wall clock", () => {
    expect(seedDay(0)).toBe("2026-07-01");
    expect(seedDay(-180)).toBe("2026-01-02");
    expect(seedDay(365)).toBe("2027-07-01");
    expect(SEED_DATE.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  test("seedUuid is stable, unique per key, and shaped like a v4 uuid", () => {
    expect(seedUuid("vendor:bahari")).toBe(seedUuid("vendor:bahari"));
    expect(seedUuid("vendor:bahari")).not.toBe(seedUuid("vendor:samudra"));
    expect(seedUuid("vendor:bahari")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("§1 accounts", () => {
  test("one login per staff actor, each holding exactly one distinct role", () => {
    expect(STAFF_SEED).toHaveLength(6);
    expect(new Set(STAFF_SEED.map((s) => s.email)).size).toBe(6);
    expect(new Set(STAFF_SEED.map((s) => s.roleCode))).toEqual(
      new Set([
        "ap_staff",
        "ap_supervisor",
        "ap_manager",
        "hod",
        "document_verifier",
        "system_administrator",
      ]),
    );
  });

  test("the fresh-signup demo address stays unseeded — it is the only Mailpit verify path", () => {
    const seeded = [...STAFF_SEED.map((s) => s.email), ...VENDOR_SEED.map((v) => v.ownerEmail)];
    expect(seeded).not.toContain(UNSEEDED_SIGNUP_EMAIL);
  });

  test("every seeded address is unique — one owner per vendor, no shared logins", () => {
    const all = [...STAFF_SEED.map((s) => s.email), ...VENDOR_SEED.map((v) => v.ownerEmail)];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("§2 vendor roster", () => {
  test("covers every reachable status and both origins", () => {
    // `blacklisted` is absent on purpose: it is only reachable via the Phase-3 Violations pillar.
    expect(new Set(VENDOR_SEED.map((v) => v.status))).toEqual(
      new Set(["draft", "pending", "pending_hod", "active", "inactive"]),
    );
    expect(new Set(VENDOR_SEED.map((v) => v.origin))).toEqual(new Set(["local", "foreign"]));
    expect(new Set(VENDOR_SEED.map((v) => v.source))).toEqual(new Set(["self", "office"]));
    expect(VENDOR_SEED).toHaveLength(8);
    expect(new Set(VENDOR_SEED.map((v) => v.slug)).size).toBe(8);
  });

  test("every vendor has exactly one primary bank (the M3.2 set-level invariant)", () => {
    for (const vendor of VENDOR_SEED) {
      expect(vendor.banks.length).toBeGreaterThan(0);
      // The real predicate, not a copy of it.
      expect(primaryCount(vendor.banks)).toBe(1);
    }
  });

  test("bank keys are unique within a vendor — they are the seeded row's identity", () => {
    for (const vendor of VENDOR_SEED) {
      expect(new Set(vendor.banks.map((b) => b.key)).size).toBe(vendor.banks.length);
    }
  });

  test("an out-of-country account carries its remark, and an in-country one doesn't need one", () => {
    for (const vendor of VENDOR_SEED) {
      for (const bank of vendor.banks) {
        const required = bankCountryRemarkRequired(bank.bankCountryIso3, vendor.countryIso3);
        if (required) expect(bank.differsFromCompanyRemark ?? "").not.toBe("");
      }
    }
  });

  test("the roster actually exercises the out-of-country remark", () => {
    // Without this, the invariant above is vacuously true and the scenario silently stops covering
    // the rule the matrix asked it to make visible (§2.2).
    const offshore = VENDOR_SEED.flatMap((v) =>
      v.banks.filter((b) => bankCountryRemarkRequired(b.bankCountryIso3, v.countryIso3)),
    );
    expect(offshore.length).toBeGreaterThan(0);
  });

  test("the roster exercises the holder-proof invariant and the CNY bank selector", () => {
    expect(VENDOR_SEED.some((v) => v.banks.some((b) => !b.holderSameAsCompany))).toBe(true);
    const currencies = new Set(VENDOR_SEED.flatMap((v) => v.banks.flatMap((b) => b.currencyCodes)));
    expect(currencies).toContain("CNY"); // SEED-4
    expect(currencies).toContain("SGD");
    expect(currencies).toContain("IDR");
  });

  test("foreign vendors leave the Indonesian tax fields unset", () => {
    for (const vendor of VENDOR_SEED.filter((v) => v.origin === "foreign")) {
      expect(vendor.taxStatus).toBeUndefined();
      expect(vendor.npwpType).toBeUndefined();
      expect(vendor.companyScale).toBeUndefined();
    }
  });

  test("local vendors carry the fields the M3.4 submit gate requires of them", () => {
    // VENDOR_SUBMIT_REQUIRED[local] = taxId + taxStatus + npwpType + companyScale. A Draft is allowed
    // to be missing them — that's the resumable-draft fixture — but anything past Draft has submitted.
    for (const vendor of VENDOR_SEED.filter((v) => v.origin === "local" && v.status !== "draft")) {
      expect(vendor.taxId).toBeTruthy();
      expect(vendor.taxStatus).toBeTruthy();
      expect(vendor.npwpType).toBeTruthy();
      expect(vendor.companyScale).toBeTruthy();
    }
  });

  test("tax ids are unique among non-Draft vendors (the vendors_tax_id_non_draft_uq index)", () => {
    const taxIds = VENDOR_SEED.filter((v) => v.status !== "draft")
      .map((v) => v.taxId)
      .filter((t): t is string => !!t);
    expect(new Set(taxIds).size).toBe(taxIds.length);
  });

  test("`inactiveReason` describes a current dormancy — set iff the vendor is Inactive", () => {
    for (const vendor of VENDOR_SEED) {
      expect(!!vendor.inactiveReason).toBe(vendor.status === "inactive");
    }
  });

  test("a shortCode is assigned on activation — so only vendors that have been activated hold one", () => {
    for (const vendor of VENDOR_SEED) {
      expect(!!vendor.shortCode).toBe(vendor.status === "active" || vendor.status === "inactive");
    }
  });

  test("the vendors that gate on verified documents have them; the queues have theirs", () => {
    // Active vendors passed the M5.2 activation gate, so their docs must be Verified — a seeded
    // Active vendor with pending docs would be a state the app itself could never have produced.
    for (const vendor of VENDOR_SEED.filter((v) => v.status === "active")) {
      expect(vendor.documents.kind).toBe("verified");
    }
    // Vendor 3 is the Document Verifier's queue item (§4).
    expect(bySlug("chandler").documents.kind).toBe("pending");
    // Vendor 5 is back in Draft *because* a mandatory doc was rejected (§4).
    expect(bySlug("krewing").documents).toMatchObject({ kind: "rejected", docNo: "DOC-001" });
    expect(bySlug("krewing").status).toBe("draft");
    // Vendor 4 sits in the HOD queue and must be activatable when the HOD approves — the gate runs
    // at that very step, so pending docs here would dead-end the golden path.
    expect(bySlug("galangan").documents.kind).toBe("verified");
    expect(bySlug("galangan").status).toBe("pending_hod");
    // Vendor 7 is the resumable half-filled Draft (§5.2).
    expect(bySlug("oceanspare").documents.kind).toBe("partial");
  });
});

describe("§4 in-flight artefacts", () => {
  test("at most one pending request per vendor (approval_requests_one_pending_per_vendor_uq)", () => {
    const slugs = IN_FLIGHT_SEED.map((r) => r.vendorSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("every request names a vendor in the roster", () => {
    for (const request of IN_FLIGHT_SEED) {
      expect(VENDOR_SEED.some((v) => v.slug === request.vendorSlug)).toBe(true);
    }
  });

  test("steps are contiguous from 1, and the current step is the first undecided one", () => {
    for (const request of IN_FLIGHT_SEED) {
      const stepNos = request.steps.map((s) => s.stepNo);
      expect(stepNos).toEqual(stepNos.map((_, i) => i + 1));

      for (const step of request.steps) {
        // Everything before the current step is decided; the current step and beyond are not.
        const expected = step.stepNo < request.currentStepNo ? "approved" : "pending";
        expect(step.decision).toBe(expected);
      }
      expect(request.steps.some((s) => s.stepNo === request.currentStepNo)).toBe(true);
    }
  });

  test("one item per Phase-0 queue — approvals, HOD, and the post-activation edit", () => {
    expect(new Set(IN_FLIGHT_SEED.map((r) => r.trigger))).toEqual(
      new Set(["new_vendor_registration", "office_vendor_registration", "bank_change"]),
    );
  });

  test("reactivation is left for the tester to submit, not seeded", () => {
    // Vendor 8 must be Inactive (hence eligible) with no request already occupying its one slot.
    expect(bySlug("pelabuhan").status).toBe("inactive");
    expect(IN_FLIGHT_SEED.some((r) => r.trigger === "reactivation")).toBe(false);
    expect(IN_FLIGHT_SEED.some((r) => r.vendorSlug === "pelabuhan")).toBe(false);
  });

  test("the mid-route approval is SoD-clean: its submitter is not the account that must decide it", () => {
    const request = IN_FLIGHT_SEED.find((r) => r.vendorSlug === "chandler");
    if (!request) throw new Error("vendor 3's approval is missing");
    expect(request.submittedBy).toEqual({ kind: "owner", slug: "chandler" });
    const current = request.steps.find((s) => s.stepNo === request.currentStepNo);
    expect(current?.roleCode).toBe("ap_supervisor");
    expect(current?.actorEmail).toBe("apsuper@vms.test");
    // The submitter is the vendor's own owner, so no staff account can be blocked as self-approver;
    // and step 1's decider (AP Staff) is not step 2's, so the SoD check has nothing to trip on.
    expect(request.steps.find((s) => s.stepNo === 1)?.actorEmail).not.toBe(current?.actorEmail);
  });

  test("the post-activation bank change proposes the account rather than adding it", () => {
    const request = IN_FLIGHT_SEED.find((r) => r.trigger === "bank_change");
    if (!request) throw new Error("the bank-change request is missing");
    // ADR-0010: the vendor stays Active and the new account lives in the payload until approval —
    // so it must NOT also appear among the vendor's seeded bank rows.
    expect(request.payload).toBeDefined();
    const vendor = bySlug(request.vendorSlug);
    expect(vendor.status).toBe("active");
    expect(vendor.banks).toHaveLength(1);
  });

  test("decided steps record when they were decided; pending steps don't", () => {
    for (const step of IN_FLIGHT_SEED.flatMap((r) => r.steps)) {
      expect(step.decidedDaysAgo !== undefined).toBe(step.decision === "approved");
    }
  });
});

describe("placeholder documents", () => {
  test("generates a structurally valid, deterministic PDF", () => {
    const bytes = placeholderPdf("Tax ID (NPWP)", ["Vendor: PT Bahari Bunker Nusantara"]);
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(bytes).toEqual(placeholderPdf("Tax ID (NPWP)", ["Vendor: PT Bahari Bunker Nusantara"]));
  });

  test("the xref table points at where the objects actually are", () => {
    // A wrong offset here is the difference between a document that opens and one that doesn't, and
    // it is invisible to every other check — the bytes look fine.
    const text = new TextDecoder().decode(placeholderPdf("Deed", ["No. 42"]));
    const offsets = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(5);
    for (const [i, offset] of offsets.entries()) {
      expect(text.slice(offset, offset + 8)).toStartWith(`${i + 1} 0 obj`);
    }
    const startXref = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(startXref, startXref + 4)).toBe("xref");
  });

  test("non-ASCII is stripped rather than corrupting the /Length the parser reads", () => {
    const text = new TextDecoder().decode(placeholderPdf("Akta — Pendirian", ["Café"]));
    const declared = Number(/<< \/Length (\d+) >>/.exec(text)?.[1]);
    const stream = /stream\n([\s\S]*?)\nendstream/.exec(text)?.[1] ?? "";
    expect(stream.length).toBe(declared);
  });
});
