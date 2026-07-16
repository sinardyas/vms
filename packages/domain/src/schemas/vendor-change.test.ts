import { describe, expect, test } from "bun:test";
import { changeTrigger, vendorChangeInput, vendorProfileChangeInput } from "./vendor-change";

const CUR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const bank = {
  bankName: "Bank Mandiri",
  accountNo: "123",
  holderName: "PT Contoh",
  currencyIds: [CUR],
  holderSameAsCompany: true,
  isPrimary: true,
};

describe("vendorProfileChangeInput", () => {
  test("omits the lifecycle-immutable origin/source (only name stays required)", () => {
    expect(vendorProfileChangeInput.safeParse({ name: "PT Baru" }).success).toBe(true);
    // origin/source are not part of the change shape — supplying them is simply ignored, not required.
    const shape = vendorProfileChangeInput.safeParse({});
    expect(shape.success).toBe(false); // name is still required
  });
});

describe("vendorChangeInput", () => {
  test("a non-bank change carries a profile diff", () => {
    const parsed = vendorChangeInput.safeParse({ kind: "non_bank", profile: { name: "PT Baru" } });
    expect(parsed.success).toBe(true);
  });

  test("a bank change requires a sound block — exactly one primary", () => {
    expect(vendorChangeInput.safeParse({ kind: "bank", banks: [bank] }).success).toBe(true);
    // two primaries is not a sound block
    const twoPrimary = vendorChangeInput.safeParse({
      kind: "bank",
      banks: [bank, { ...bank, isPrimary: true }],
    });
    expect(twoPrimary.success).toBe(false);
    // an empty set parses here (zero-banks is allowed at the block level); the ≥1-account rule for a
    // post-activation change is gate-owned policy enforced by the route, matching the submit gate.
    expect(vendorChangeInput.safeParse({ kind: "bank", banks: [] }).success).toBe(true);
  });

  test("rejects an unknown kind", () => {
    expect(vendorChangeInput.safeParse({ kind: "reactivation", profile: {} }).success).toBe(false);
  });
});

describe("changeTrigger", () => {
  test("routes bank → bank_change (AP Manager), non-bank → non_bank_change (AP Supervisor)", () => {
    expect(changeTrigger("bank")).toBe("bank_change");
    expect(changeTrigger("non_bank")).toBe("non_bank_change");
  });
});
