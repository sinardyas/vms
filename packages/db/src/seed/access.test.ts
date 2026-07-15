/**
 * Static invariants over the access seed (M1.2, #21). Pure — no DB — so CI catches a deadlocked or
 * grant-less role grid before it ever reaches a `docker compose up`. The live upsert is verified
 * separately by running the seed against the Docker Postgres (see the ticket resolution).
 */
import { describe, expect, test } from "bun:test";
import { rbacModuleEnum } from "../schema/enums";
import { ROLE_SEED, type RoleSeed, assertRoleSeedConsistent } from "./access";

describe("access seed grid", () => {
  test("passes its own consistency assertions", () => {
    expect(() => assertRoleSeedConsistent()).not.toThrow();
  });

  test("seeds the seven domain-model actors with unique codes", () => {
    const codes = ROLE_SEED.map((r) => r.code);
    expect(codes).toEqual([
      "system_administrator",
      "ap_staff",
      "ap_supervisor",
      "ap_manager",
      "hod",
      "document_verifier",
      "vendor",
    ]);
    expect(new Set(codes).size).toBe(codes.length);
  });

  test("no role is grant-less (DoD)", () => {
    for (const role of ROLE_SEED) {
      const grantCount = Object.values(role.grants).reduce((n, verbs) => n + (verbs?.length ?? 0), 0);
      expect(grantCount).toBeGreaterThan(0);
    }
  });

  test("every grant names a real module and verb", () => {
    const modules = new Set<string>(rbacModuleEnum.enumValues);
    const verbs = new Set(["add", "edit", "delete", "view", "approve"]);
    for (const role of ROLE_SEED) {
      for (const [module, granted] of Object.entries(role.grants)) {
        expect(modules.has(module)).toBe(true);
        for (const verb of granted ?? []) expect(verbs.has(verb)).toBe(true);
      }
    }
  });

  test("deadlock guard: every seeded route decider holds the matching approve permission", () => {
    const holds = (code: string, module: string, verb: string) =>
      ROLE_SEED.find((r) => r.code === code)
        ?.grants[module as keyof RoleSeed["grants"]]?.includes(verb as never) ?? false;
    for (const code of ["ap_staff", "ap_supervisor", "ap_manager", "hod"]) {
      expect(holds(code, "approvals", "approve")).toBe(true);
    }
    // Verify ≈ Documents approve (ADR-0011/0012).
    expect(holds("document_verifier", "documents", "approve")).toBe(true);
  });

  test("system_administrator holds the whole 9×5 matrix", () => {
    const admin = ROLE_SEED.find((r) => r.code === "system_administrator");
    expect(admin).toBeDefined();
    expect(Object.keys(admin?.grants ?? {}).length).toBe(rbacModuleEnum.enumValues.length);
    for (const module of rbacModuleEnum.enumValues) {
      expect(admin?.grants[module]).toEqual(["add", "edit", "delete", "view", "approve"]);
    }
  });

  test("a grant-less role trips the assertion", () => {
    const bad: RoleSeed[] = [{ code: "empty", nameId: "x", nameEn: "x", grants: {} }];
    expect(() => assertRoleSeedConsistent(bad)).toThrow(/grant-less/);
  });
});
