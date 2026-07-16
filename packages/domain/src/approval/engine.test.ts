import { describe, expect, test } from "bun:test";
import { applyDecision, planSteps } from "./engine";

describe("applyDecision", () => {
  test("approve a non-final step advances, no subject effect", () => {
    expect(applyDecision(1, 2, "approve")).toEqual({
      requestStatus: "pending",
      subjectEffect: "none",
      advanceToStepNo: 2,
      resolved: false,
    });
  });

  test("approve the final step resolves approved and activates the subject", () => {
    expect(applyDecision(2, 2, "approve")).toEqual({
      requestStatus: "approved",
      subjectEffect: "activate",
      advanceToStepNo: null,
      resolved: true,
    });
  });

  test("a single-step route (office → HOD) activates on the first approval", () => {
    expect(applyDecision(1, 1, "approve")).toEqual({
      requestStatus: "approved",
      subjectEffect: "activate",
      advanceToStepNo: null,
      resolved: true,
    });
  });

  test("reject at the first step resolves rejected and returns the subject to Draft", () => {
    expect(applyDecision(1, 2, "reject")).toEqual({
      requestStatus: "rejected",
      subjectEffect: "return_to_draft",
      advanceToStepNo: null,
      resolved: true,
    });
  });

  test("reject at a later step also returns to Draft (no partial-approval survives)", () => {
    expect(applyDecision(2, 2, "reject")).toEqual({
      requestStatus: "rejected",
      subjectEffect: "return_to_draft",
      advanceToStepNo: null,
      resolved: true,
    });
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
