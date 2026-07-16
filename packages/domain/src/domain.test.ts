/**
 * Smoke tests for the domain substrate (M0.3). Run with `bun test`.
 * Not part of `tsc` typecheck (excluded in tsconfig) — Bun provides `bun:test` at runtime.
 */

import { describe, expect, test } from "bun:test";
import {
  type Actor,
  type ApproverCandidate,
  approverIneligibility,
  can,
  capabilities,
  eligibleApprovers,
  hasEligibleApprover,
  hasOverrideAuthority,
  isEligibleApprover,
  permissionKey,
  toPermissionSet,
} from "./access";
import { forbiddenError, isDomainError, validationError } from "./errors";
import { translate, translator } from "./i18n";
import { err, isErr, isOk, map, ok, unwrapOr } from "./result";
import { parseWith } from "./schemas";
import { ORIGINS, originSchema, resolveLocale } from "./values";

describe("Result", () => {
  test("ok / err carry and narrow", () => {
    const good = ok(42);
    const bad = err("nope");
    expect(isOk(good)).toBe(true);
    expect(isErr(bad)).toBe(true);
    if (good.ok) expect(good.value).toBe(42);
  });

  test("map transforms success, passes failure through", () => {
    expect(map(ok(2), (n) => n * 3)).toEqual(ok(6));
    const failure = err("x");
    expect(map(failure, (n: number) => n)).toBe(failure);
    expect(unwrapOr(err("x"), 7)).toBe(7);
  });
});

describe("DomainError", () => {
  test("constructors default their code + messageKey", () => {
    const e = forbiddenError();
    expect(e.code).toBe("forbidden");
    expect(e.messageKey).toBe("error.forbidden");
    expect(isDomainError(e)).toBe(true);
  });

  test("validationError carries details", () => {
    const e = validationError({ details: { field: "email" } });
    expect(e.code).toBe("validation");
    expect(e.details).toEqual({ field: "email" });
  });
});

describe("i18n", () => {
  test("resolves per locale with interpolation", () => {
    expect(translate("enum.origin.local", "id")).toBe("Dalam Negeri");
    expect(translate("enum.origin.local", "en")).toBe("Local");
  });

  test("defaults to id and is bound by translator()", () => {
    expect(translate("error.forbidden")).toBe(translate("error.forbidden", "id"));
    const t = translator("en");
    expect(t("error.notFound")).toBe("The requested record was not found.");
  });
});

describe("values + schemas", () => {
  test("enum schema mirrors the tuple", () => {
    for (const o of ORIGINS) expect(originSchema.parse(o)).toBe(o);
    expect(originSchema.safeParse("martian").success).toBe(false);
  });

  test("parseWith bridges Zod into a Result", () => {
    expect(parseWith(originSchema, "foreign")).toEqual(ok("foreign"));
    const bad = parseWith(originSchema, "martian");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("validation");
  });

  test("resolveLocale falls back to default for junk", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("fr")).toBe("id");
    expect(resolveLocale(undefined)).toBe("id");
  });
});

describe("RBAC seam", () => {
  const actor: Actor = {
    userId: "u1",
    kind: "internal",
    email: "staff@soechi.id",
    name: "Staff",
    permissions: toPermissionSet([
      { module: "vendors", verb: "view" },
      { module: "vendors", verb: "edit" },
    ]),
  };

  test("can() is deny-by-default and grant-driven", () => {
    expect(can(actor, "vendors", "view")).toBe(true);
    expect(can(actor, "vendors", "delete")).toBe(false); // not granted
    expect(can(actor, "access", "view")).toBe(false); // other module
    expect(can(null, "vendors", "view")).toBe(false); // unauthenticated
    expect(permissionKey("vendors", "view")).toBe("vendors:view");
  });

  test("capabilities() expands the set into the full module×verb map", () => {
    const flags = capabilities(actor.permissions);
    expect(flags.vendors.view).toBe(true);
    expect(flags.vendors.edit).toBe(true);
    expect(flags.vendors.delete).toBe(false);
    expect(flags.audit.view).toBe(false);
  });
});

describe("Approver eligibility (M1.6, SoD)", () => {
  const approver = (userId: string): ApproverCandidate => ({
    userId,
    permissions: toPermissionSet([{ module: "approvals", verb: "approve" }]),
  });
  const staff = (userId: string): ApproverCandidate => ({
    userId,
    permissions: toPermissionSet([{ module: "approvals", verb: "view" }]), // no approve grant
  });

  test("role ∩ approve-perm: candidate must hold the approve grant", () => {
    expect(isEligibleApprover(approver("a1"), {})).toBe(true);
    expect(isEligibleApprover(staff("s1"), {})).toBe(false);
    expect(approverIneligibility(staff("s1"), {})).toBe("missing-permission");
  });

  test("no self-approval: the submitter is barred even with the grant", () => {
    expect(approverIneligibility(approver("a1"), { submitterUserId: "a1" })).toBe("self-approval");
    expect(isEligibleApprover(approver("a2"), { submitterUserId: "a1" })).toBe(true);
    // null / undefined submitter applies no self-approval exclusion
    expect(isEligibleApprover(approver("a1"), { submitterUserId: null })).toBe(true);
  });

  test("verifier ≠ approver: any document verifier on the vendor is barred", () => {
    const sod = { verifierUserIds: ["v1", "v2"] };
    expect(approverIneligibility(approver("v1"), sod)).toBe("verifier");
    expect(isEligibleApprover(approver("a3"), sod)).toBe(true);
  });

  test("precedence: permission checked before SoD (ADR-0009 order)", () => {
    // a submitter who also lacks the grant reports the missing permission first
    expect(approverIneligibility(staff("s1"), { submitterUserId: "s1" })).toBe(
      "missing-permission",
    );
    // a submitter who is also a verifier reports self-approval (submitter before verifier)
    expect(
      approverIneligibility(approver("a1"), { submitterUserId: "a1", verifierUserIds: ["a1"] }),
    ).toBe("self-approval");
  });

  test("required permission is overridable (document-verifier eligibility)", () => {
    const docApprover: ApproverCandidate = {
      userId: "d1",
      permissions: toPermissionSet([{ module: "documents", verb: "approve" }]),
    };
    expect(isEligibleApprover(docApprover, {})).toBe(false); // lacks approvals:approve
    expect(isEligibleApprover(docApprover, {}, { module: "documents", verb: "approve" })).toBe(
      true,
    );
  });

  test("eligibleApprovers / hasEligibleApprover subtract the full SoD set", () => {
    const pool = [approver("submitter"), approver("verifier"), approver("clean"), staff("nograt")];
    const sod = { submitterUserId: "submitter", verifierUserIds: ["verifier"] };
    expect(eligibleApprovers(pool, sod).map((c) => c.userId)).toEqual(["clean"]);
    expect(hasEligibleApprover(pool, sod)).toBe(true);
    // when SoD strands the last holder, the pool is empty → engine must escalate (M4.3)
    const only = [approver("submitter")];
    expect(eligibleApprovers(only, { submitterUserId: "submitter" })).toHaveLength(0);
    expect(hasEligibleApprover(only, { submitterUserId: "submitter" })).toBe(false);
  });

  test("admin override authority = approvals:edit, distinct from approve (M4.3, ADR-0014)", () => {
    // a plain approver (only approvals:approve) is NOT an override authority
    expect(hasOverrideAuthority(approver("a1"))).toBe(false);
    const admin: ApproverCandidate = {
      userId: "admin",
      permissions: toPermissionSet([
        { module: "approvals", verb: "approve" },
        { module: "approvals", verb: "edit" },
      ]),
    };
    expect(hasOverrideAuthority(admin)).toBe(true);
  });
});
