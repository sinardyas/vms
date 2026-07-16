import { describe, expect, test } from "bun:test";
import { applyDecision, isEditTrigger, planSteps } from "./engine";

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

describe("isEditTrigger", () => {
  test("bank/non-bank changes are edits; registration + reactivation are not", () => {
    expect(isEditTrigger("bank_change")).toBe(true);
    expect(isEditTrigger("non_bank_change")).toBe(true);
    expect(isEditTrigger("new_vendor_registration")).toBe(false);
    expect(isEditTrigger("office_vendor_registration")).toBe(false);
    expect(isEditTrigger("reactivation")).toBe(false);
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
