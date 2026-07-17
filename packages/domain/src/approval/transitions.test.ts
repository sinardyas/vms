import { describe, expect, it } from "bun:test";
import type { StepDecision, VendorStatus } from "../values/enums";
import { canDeactivate, canReactivate, isCaptureEditable, isRecallable } from "./transitions";

describe("isCaptureEditable (freeze, ADR-0014)", () => {
  it("only a Draft is editable", () => {
    expect(isCaptureEditable("draft")).toBe(true);
  });

  it("every submitted / resolved state is frozen", () => {
    const frozen: VendorStatus[] = ["pending", "pending_hod", "active", "inactive", "blacklisted"];
    for (const status of frozen) expect(isCaptureEditable(status)).toBe(false);
  });
});

describe("isRecallable (pre-decision window, ADR-0010)", () => {
  it("a pending request with no decided step is recallable", () => {
    expect(isRecallable("pending", ["pending", "pending"])).toBe(true);
  });

  it("a freshly-opened request (no steps yet) is recallable", () => {
    expect(isRecallable("pending", [])).toBe(true);
  });

  it("a decision on any step closes the window", () => {
    expect(isRecallable("pending", ["approved", "pending"])).toBe(false);
    expect(isRecallable("pending", ["pending", "rejected"])).toBe(false);
  });

  it("an already-resolved request is never recallable", () => {
    const resolved = ["approved", "rejected", "recalled"] as const;
    for (const status of resolved) {
      expect(isRecallable(status, ["pending"] as StepDecision[])).toBe(false);
    }
  });
});

describe("canDeactivate (Active→Inactive, M6.4/ADR-0009)", () => {
  it("only an Active vendor is in service to withdraw", () => {
    expect(canDeactivate("active")).toBe(true);
  });

  it("every other state has nothing to take out of service", () => {
    const rest = [
      "draft",
      "pending",
      "pending_hod",
      "inactive",
    ] as const satisfies readonly VendorStatus[];
    for (const status of rest) {
      expect(canDeactivate(status)).toBe(false);
    }
  });

  it("blacklisted is not softened to Inactive — the sanction is the Phase-3 pillar's, not ours", () => {
    expect(canDeactivate("blacklisted")).toBe(false);
  });
});

describe("canReactivate (Inactive→Active, M6.4/ADR-0009)", () => {
  it("only an Inactive vendor can be raised for reactivation", () => {
    expect(canReactivate("inactive")).toBe(true);
  });

  it("every other state is either live already or never was", () => {
    const rest = [
      "draft",
      "pending",
      "pending_hod",
      "active",
    ] as const satisfies readonly VendorStatus[];
    for (const status of rest) {
      expect(canReactivate(status)).toBe(false);
    }
  });

  it("blacklisted cannot route around its sanction", () => {
    expect(canReactivate("blacklisted")).toBe(false);
  });
});
