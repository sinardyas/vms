/**
 * Approval-routes domain logic (M2.4, #35) — the pure core: request schemas + the deadlock-guard
 * delta. Run with `bun test`. No Postgres; the store's real queries are exercised live under Docker.
 *
 * The one rule with real logic is `strandedStepRoles` — the delta that decides when a steps save
 * strands the route (a step role with no eligible approver) *without* nagging through greenfield,
 * mirroring M1.5's before/after guard (#24). We pin every branch of that delta plus the schema edges.
 */

import { describe, expect, test } from "bun:test";
import {
  createRouteSchema,
  formatStrandedRoles,
  replaceStepsSchema,
  strandedStepRoles,
} from "./approval-routes-service";

const R1 = "11111111-1111-4111-8111-111111111111";
const R2 = "22222222-2222-4222-8222-222222222222";
const R3 = "33333333-3333-4333-8333-333333333333";

describe("strandedStepRoles — the deadlock-guard delta", () => {
  test("greenfield (no role staffable) never warns — every route was already un-executable", () => {
    // Before = the seeded route's roles, none staffable (no users assigned yet). A save can't strand
    // a route that was never sound → no warning, so seeding + early edits don't nag.
    expect(strandedStepRoles([R1, R2], [R1, R3], new Set())).toEqual([]);
  });

  test("a working route (all roles staffable) going to an un-staffable step warns with that role", () => {
    // R1, R2 staffable (route sound before); the save points step 2 at R3, which has no approver.
    expect(strandedStepRoles([R1, R2], [R1, R3], new Set([R1, R2]))).toEqual([R3]);
  });

  test("a working route staying fully staffable does not warn", () => {
    expect(strandedStepRoles([R1, R2], [R2, R1], new Set([R1, R2]))).toEqual([]);
  });

  test("an already-broken route (a before role un-staffable) never warns, even adding another gap", () => {
    // R2 wasn't staffable before → the route wasn't sound → the guard stays silent (delta, not absolute).
    expect(strandedStepRoles([R1, R2], [R3], new Set([R1]))).toEqual([]);
  });

  test("a brand-new route (no prior steps) never strands — nothing to worsen yet", () => {
    expect(strandedStepRoles([], [R1, R2], new Set([R1]))).toEqual([]);
  });

  test("multiple stranded roles are de-duplicated", () => {
    expect(strandedStepRoles([R1], [R2, R3, R2], new Set([R1]))).toEqual([R2, R3]);
  });
});

describe("formatStrandedRoles", () => {
  test("renders the role codes in order", () => {
    expect(
      formatStrandedRoles([
        { id: R1, code: "hod", nameId: "HOD", nameEn: "HOD" },
        { id: R2, code: "ap_manager", nameId: "Manajer AP", nameEn: "AP Manager" },
      ]),
    ).toBe("hod, ap_manager");
  });
});

describe("createRouteSchema", () => {
  test("accepts a valid trigger + bilingual name", () => {
    const r = createRouteSchema.safeParse({
      trigger: "office_vendor_registration",
      nameId: "Pendaftaran Vendor oleh Kantor",
      nameEn: "Office Vendor Registration",
    });
    expect(r.success).toBe(true);
  });

  test("rejects an unknown trigger (only the five approval_trigger values route)", () => {
    const r = createRouteSchema.safeParse({
      trigger: "blacklist",
      nameId: "x",
      nameEn: "x",
    });
    expect(r.success).toBe(false);
  });

  test("rejects a blank bilingual side", () => {
    const r = createRouteSchema.safeParse({
      trigger: "bank_change",
      nameId: "",
      nameEn: "Bank Change",
    });
    expect(r.success).toBe(false);
  });
});

describe("replaceStepsSchema", () => {
  test("accepts an ordered list of role ids (+ optional confirm)", () => {
    const r = replaceStepsSchema.safeParse({
      steps: [{ roleId: R1 }, { roleId: R2 }],
      confirm: true,
    });
    expect(r.success).toBe(true);
  });

  test("rejects an empty step list — a route needs at least one step", () => {
    const r = replaceStepsSchema.safeParse({ steps: [] });
    expect(r.success).toBe(false);
  });

  test("rejects a non-uuid roleId", () => {
    const r = replaceStepsSchema.safeParse({ steps: [{ roleId: "not-a-uuid" }] });
    expect(r.success).toBe(false);
  });
});
