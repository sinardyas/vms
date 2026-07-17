/**
 * Role-grant eligibility (#96) — role administration is an internal-user surface. Run with `bun test`.
 *
 * The pure half of the invariant: the rule refuses a hand-administered role patch on any vendor-kind
 * subject and leaves internal subjects alone. The revocation case is the load-bearing one — a vendor
 * user's `vendor` role is what keeps the portal working, so clearing it by hand is refused too.
 */

import { describe, expect, test } from "bun:test";
import { mayGrantRoles, roleGrantRefusal } from "./grants";

describe("roleGrantRefusal", () => {
  test("refuses a grant to a vendor-kind subject", () => {
    expect(roleGrantRefusal({ kind: "vendor" })).toBe("vendor-subject");
    expect(mayGrantRoles({ kind: "vendor" })).toBe(false);
  });

  test("refuses a revocation on a vendor subject — the `vendor` role is load-bearing", () => {
    expect(roleGrantRefusal({ kind: "vendor" })).toBe("vendor-subject");
  });

  test("allows a grant to an internal subject", () => {
    expect(roleGrantRefusal({ kind: "internal" })).toBeNull();
    expect(mayGrantRoles({ kind: "internal" })).toBe(true);
  });
});
