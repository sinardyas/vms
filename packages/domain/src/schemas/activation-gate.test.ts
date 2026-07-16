/**
 * Activation gate — the pure "may this registration activate?" predicate (M5.2, #69). Run with `bun test`.
 *
 * Covers the blocker list, the "N of M" counts, and the DomainError mapping. The gate clears only when
 * every mandatory doc's current version is Verified; pending / rejected / no-version all block.
 */

import { describe, expect, test } from "bun:test";
import {
  type VerifiableDocument,
  activationGate,
  activationGateError,
  unverifiedMandatoryDocuments,
} from "./activation-gate";

const doc = (
  id: string,
  status: VerifiableDocument["currentVersionStatus"],
): VerifiableDocument => ({
  documentMasterId: id,
  currentVersionStatus: status,
});

describe("unverifiedMandatoryDocuments", () => {
  test("empty when every required doc is verified", () => {
    const out = unverifiedMandatoryDocuments(
      ["a", "b"],
      [doc("a", "verified"), doc("b", "verified")],
    );
    expect(out).toEqual([]);
  });

  test("a pending version blocks", () => {
    expect(unverifiedMandatoryDocuments(["a"], [doc("a", "pending")])).toEqual(["a"]);
  });

  test("a rejected version blocks", () => {
    expect(unverifiedMandatoryDocuments(["a"], [doc("a", "rejected")])).toEqual(["a"]);
  });

  test("a required doc with no captured version blocks", () => {
    expect(unverifiedMandatoryDocuments(["a", "b"], [doc("a", "verified")])).toEqual(["b"]);
    expect(unverifiedMandatoryDocuments(["a"], [doc("a", null)])).toEqual(["a"]);
  });

  test("collapses duplicate required ids", () => {
    expect(unverifiedMandatoryDocuments(["a", "a"], [])).toEqual(["a"]);
  });

  test("ignores verified docs that aren't required", () => {
    expect(
      unverifiedMandatoryDocuments(["a"], [doc("a", "verified"), doc("z", "verified")]),
    ).toEqual([]);
  });
});

describe("activationGate", () => {
  test("ok with the full N-of-N count when all verified", () => {
    const gate = activationGate(["a", "b"], [doc("a", "verified"), doc("b", "verified")]);
    expect(gate).toEqual({ ok: true, requiredCount: 2, verifiedCount: 2, blockers: [] });
  });

  test("reports the partial count + blockers when some are outstanding", () => {
    const gate = activationGate(["a", "b", "c"], [doc("a", "verified"), doc("b", "pending")]);
    expect(gate.ok).toBe(false);
    expect(gate.requiredCount).toBe(3);
    expect(gate.verifiedCount).toBe(1);
    expect(gate.blockers).toEqual(["b", "c"]);
  });

  test("vacuously ok when nothing is required", () => {
    expect(activationGate([], [])).toEqual({
      ok: true,
      requiredCount: 0,
      verifiedCount: 0,
      blockers: [],
    });
  });
});

describe("activationGateError", () => {
  test("maps a blocked gate to a conflict carrying counts + blockers", () => {
    const gate = activationGate(["a", "b"], [doc("a", "verified"), doc("b", "pending")]);
    const err = activationGateError(gate);
    expect(err.code).toBe("conflict");
    expect(err.messageKey).toBe("error.approval.activationGateBlocked");
    expect(err.params).toEqual({ verified: 1, required: 2 });
    expect(err.details).toEqual(["b"]);
  });
});
