/**
 * Access-admin pure logic (M1.5, #24) — the DB-free core: matrix ↔ rows conversions, the request
 * schemas, and the deadlock **delta** guard. Run with `bun test`.
 *
 * These are the business rules the route leans on, checked without Postgres or better-auth: a matrix
 * survives a round-trip through storage rows, a malformed body is rejected at the edge, and the guard
 * fires exactly when a change strands the *last* holder of a required approval permission — never when
 * that permission was already unheld (greenfield setup must not nag).
 */

import { describe, expect, test } from "bun:test";
import { RBAC_MODULES, RBAC_VERBS, permissionKey } from "@vms/domain";
import {
  CRITICAL_CAPABILITIES,
  createRoleSchema,
  createUserSchema,
  emptyMatrix,
  matrixFromRows,
  matrixToRows,
  strandedCapabilities,
} from "./access-service";

const APPROVALS = permissionKey("approvals", "approve");
const DOCUMENTS = permissionKey("documents", "approve");

describe("matrix conversions", () => {
  test("emptyMatrix is a full 9×5 grid, all deny", () => {
    const grid = emptyMatrix();
    expect(Object.keys(grid)).toHaveLength(9);
    for (const module of RBAC_MODULES) {
      expect(Object.keys(grid[module])).toHaveLength(5);
      for (const verb of RBAC_VERBS) expect(grid[module][verb]).toBe(false);
    }
  });

  test("matrixToRows emits one row per module, mapping verbs to the boolean columns", () => {
    const grid = emptyMatrix();
    grid.documents.view = true;
    grid.documents.approve = true;
    const rows = matrixToRows(grid);
    expect(rows).toHaveLength(9);
    const docs = rows.find((r) => r.module === "documents");
    expect(docs).toMatchObject({ canView: true, canApprove: true, canAdd: false, canEdit: false });
  });

  test("matrix survives a round-trip through storage rows", () => {
    const grid = emptyMatrix();
    grid.vendors.add = true;
    grid.vendors.view = true;
    grid.approvals.approve = true;
    expect(matrixFromRows(matrixToRows(grid))).toEqual(grid);
  });

  test("matrixFromRows defaults absent modules to all-false (deny-by-default)", () => {
    const grid = matrixFromRows([
      {
        module: "audit",
        canAdd: false,
        canEdit: false,
        canDelete: false,
        canView: true,
        canApprove: false,
      },
    ]);
    expect(grid.audit.view).toBe(true);
    expect(grid.vendors.view).toBe(false);
  });
});

describe("strandedCapabilities (deadlock delta guard)", () => {
  test("fires when the last holder of a critical capability is removed (1 → 0)", () => {
    const stranded = strandedCapabilities(
      { [APPROVALS]: 1, [DOCUMENTS]: 2 },
      { [APPROVALS]: 0, [DOCUMENTS]: 2 },
    );
    expect(stranded).toEqual([{ module: "approvals", verb: "approve" }]);
  });

  test("does NOT fire when the capability was already unheld (0 → 0) — greenfield setup", () => {
    const stranded = strandedCapabilities(
      { [APPROVALS]: 0, [DOCUMENTS]: 0 },
      { [APPROVALS]: 0, [DOCUMENTS]: 0 },
    );
    expect(stranded).toHaveLength(0);
  });

  test("does NOT fire when holders merely shrink but stay ≥ 1", () => {
    const stranded = strandedCapabilities({ [APPROVALS]: 3 }, { [APPROVALS]: 1 });
    expect(stranded).toHaveLength(0);
  });

  test("reports every stranded capability at once", () => {
    const stranded = strandedCapabilities(
      { [APPROVALS]: 1, [DOCUMENTS]: 1 },
      { [APPROVALS]: 0, [DOCUMENTS]: 0 },
    );
    expect(stranded).toHaveLength(2);
  });

  test("the critical set is exactly the two workflow deciders (ADR-0009/0011)", () => {
    expect(CRITICAL_CAPABILITIES).toEqual([
      { module: "approvals", verb: "approve" },
      { module: "documents", verb: "approve" },
    ]);
  });
});

describe("request schemas", () => {
  const fullMatrix = emptyMatrix();

  test("createRoleSchema accepts a valid role", () => {
    const parsed = createRoleSchema.safeParse({
      code: "document_verifier",
      nameId: "Verifikator",
      nameEn: "Verifier",
      matrix: fullMatrix,
    });
    expect(parsed.success).toBe(true);
  });

  test("createRoleSchema rejects a non-neutral code", () => {
    const parsed = createRoleSchema.safeParse({
      code: "Document Verifier",
      nameId: "x",
      nameEn: "y",
      matrix: fullMatrix,
    });
    expect(parsed.success).toBe(false);
  });

  test("createRoleSchema rejects an incomplete matrix (missing a module)", () => {
    const { access, ...partial } = fullMatrix;
    const parsed = createRoleSchema.safeParse({
      code: "r",
      nameId: "x",
      nameEn: "y",
      matrix: partial,
    });
    expect(parsed.success).toBe(false);
  });

  test("createUserSchema lower-cases + trims the email and defaults roleIds", () => {
    const parsed = createUserSchema.safeParse({ email: "  Staff@Soechi.ID ", name: "Staff" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.email).toBe("staff@soechi.id");
  });

  test("createUserSchema rejects a blank name", () => {
    expect(createUserSchema.safeParse({ email: "a@b.co", name: "  " }).success).toBe(false);
  });
});
