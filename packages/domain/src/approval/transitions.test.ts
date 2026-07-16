import { describe, expect, it } from "bun:test";
import type { StepDecision, VendorStatus } from "../values/enums";
import { isCaptureEditable, isRecallable } from "./transitions";

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
