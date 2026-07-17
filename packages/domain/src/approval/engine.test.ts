import { describe, expect, test } from "bun:test";
import { APPROVAL_TRIGGERS } from "../values";
import {
  applyDecision,
  decisionNoticeKind,
  isEditTrigger,
  isReactivationTrigger,
  planSteps,
} from "./engine";

describe("applyDecision — registration triggers", () => {
  test("approve a non-final step advances, no subject effect", () => {
    expect(applyDecision(1, 2, "approve", "new_vendor_registration")).toEqual({
      requestStatus: "pending",
      subjectEffect: "none",
      advanceToStepNo: 2,
      resolved: false,
    });
  });

  test("approve the final step resolves approved and activates the subject", () => {
    expect(applyDecision(2, 2, "approve", "new_vendor_registration")).toEqual({
      requestStatus: "approved",
      subjectEffect: "activate",
      advanceToStepNo: null,
      resolved: true,
    });
  });

  test("a single-step route (office → HOD) activates on the first approval", () => {
    expect(applyDecision(1, 1, "approve", "office_vendor_registration")).toEqual({
      requestStatus: "approved",
      subjectEffect: "activate",
      advanceToStepNo: null,
      resolved: true,
    });
  });

  test("reactivation is registration-like — final approve activates the subject", () => {
    expect(applyDecision(1, 1, "approve", "reactivation")).toEqual({
      requestStatus: "approved",
      subjectEffect: "activate",
      advanceToStepNo: null,
      resolved: true,
    });
  });

  test("reject at the first step resolves rejected and returns the subject to Draft", () => {
    expect(applyDecision(1, 2, "reject", "new_vendor_registration")).toEqual({
      requestStatus: "rejected",
      subjectEffect: "return_to_draft",
      advanceToStepNo: null,
      resolved: true,
    });
  });

  test("reject at a later step also returns to Draft (no partial-approval survives)", () => {
    expect(applyDecision(2, 2, "reject", "new_vendor_registration")).toEqual({
      requestStatus: "rejected",
      subjectEffect: "return_to_draft",
      advanceToStepNo: null,
      resolved: true,
    });
  });
});

describe("applyDecision — edit triggers (M4.5)", () => {
  test("bank-change final approve applies the diff (not activate); subject stays Active", () => {
    expect(applyDecision(2, 2, "approve", "bank_change")).toEqual({
      requestStatus: "approved",
      subjectEffect: "apply_change",
      advanceToStepNo: null,
      resolved: true,
    });
  });

  test("non-bank-change advances on a non-final approve, no subject effect", () => {
    expect(applyDecision(1, 2, "approve", "non_bank_change")).toEqual({
      requestStatus: "pending",
      subjectEffect: "none",
      advanceToStepNo: 2,
      resolved: false,
    });
  });

  test("edit reject discards the diff (not return-to-draft); subject unchanged", () => {
    expect(applyDecision(1, 2, "reject", "non_bank_change")).toEqual({
      requestStatus: "rejected",
      subjectEffect: "discard_change",
      advanceToStepNo: null,
      resolved: true,
    });
  });
});

describe("applyDecision — reactivation (M6.4)", () => {
  test("reject leaves the subject Inactive rather than returning it to Draft", () => {
    expect(applyDecision(1, 1, "reject", "reactivation")).toEqual({
      requestStatus: "rejected",
      subjectEffect: "keep_inactive",
      advanceToStepNo: null,
      resolved: true,
    });
  });

  test("a rejected registration still returns to Draft — reactivation is the only exception", () => {
    for (const trigger of ["new_vendor_registration", "office_vendor_registration"] as const) {
      expect(applyDecision(1, 1, "reject", trigger).subjectEffect).toBe("return_to_draft");
    }
  });

  test("the AP-Manager route is single-step, so step 1 is final — approve activates immediately", () => {
    const outcome = applyDecision(1, 1, "approve", "reactivation");
    expect(outcome.subjectEffect).toBe("activate");
    expect(outcome.resolved).toBe(true);
    expect(outcome.advanceToStepNo).toBeNull();
  });
});

describe("isReactivationTrigger", () => {
  test("only `reactivation` is a reactivation", () => {
    expect(isReactivationTrigger("reactivation")).toBe(true);
    expect(isReactivationTrigger("new_vendor_registration")).toBe(false);
    expect(isReactivationTrigger("office_vendor_registration")).toBe(false);
    expect(isReactivationTrigger("bank_change")).toBe(false);
    expect(isReactivationTrigger("non_bank_change")).toBe(false);
  });
});

describe("isEditTrigger", () => {
  test("bank/non-bank changes are edits; registration + reactivation are not", () => {
    expect(isEditTrigger("bank_change")).toBe(true);
    expect(isEditTrigger("non_bank_change")).toBe(true);
    expect(isEditTrigger("new_vendor_registration")).toBe(false);
    expect(isEditTrigger("office_vendor_registration")).toBe(false);
    expect(isEditTrigger("reactivation")).toBe(false);
  });
});

describe("decisionNoticeKind (M6.5e)", () => {
  test("every trigger has an answer, and it follows the trigger families", () => {
    // Exhaustive over the enum on purpose: this is the rule deciding whether a vendor hears anything
    // at all, and a trigger added without an answer here would default to silence unnoticed — which
    // is exactly the hole M6.4 left for reactivation.
    const kinds = APPROVAL_TRIGGERS.map((t) => [t, decisionNoticeKind(t)] as const);
    expect(Object.fromEntries(kinds)).toEqual({
      new_vendor_registration: "registration",
      office_vendor_registration: "registration",
      reactivation: "reactivation",
      bank_change: null,
      non_bank_change: null,
    });
  });

  test("a reactivation is not silent — the M6.4 suppression is gone (M6.5e)", () => {
    // The ticket in one assertion: M6.4 had this returning nothing for a reactivation, so a vendor
    // learned nothing when their return to service was decided either way.
    expect(decisionNoticeKind("reactivation")).not.toBeNull();
  });

  test("an edit stays silent — the vendor's own standing never moved (M4.5)", () => {
    expect(decisionNoticeKind("bank_change")).toBeNull();
    expect(decisionNoticeKind("non_bank_change")).toBeNull();
  });
});

describe("planSteps", () => {
  test("numbers steps 1-based from the route's role order", () => {
    expect(planSteps(["role-a", "role-b"])).toEqual([
      { stepNo: 1, roleId: "role-a" },
      { stepNo: 2, roleId: "role-b" },
    ]);
  });

  test("an empty route plans no steps", () => {
    expect(planSteps([])).toEqual([]);
  });
});
