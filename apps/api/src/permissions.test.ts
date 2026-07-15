/**
 * M1.1 (#20) — role-grant expansion. Run with `bun test`. No DB: the pure `expandGrants` mapping is
 * exercised directly against `role_permissions`-shaped rows, isolating the RBAC business rule (which
 * verb column grants what, and how multiple roles union) from the Drizzle query that feeds it.
 */

import { describe, expect, test } from "bun:test";
import { RBAC_MODULES, RBAC_VERBS, permissionKey } from "@vms/domain";
import { type GrantRow, expandGrants } from "./permissions";

const row = (
  module: GrantRow["module"],
  flags: Partial<Omit<GrantRow, "module">> = {},
): GrantRow => ({
  module,
  canAdd: false,
  canEdit: false,
  canDelete: false,
  canView: false,
  canApprove: false,
  ...flags,
});

describe("expandGrants", () => {
  test("no rows → empty set (deny-by-default)", () => {
    expect(expandGrants([]).size).toBe(0);
  });

  test("a row with every column false grants nothing", () => {
    expect(expandGrants([row("vendors")]).size).toBe(0);
  });

  test("each true column becomes its (module, verb) grant", () => {
    const set = expandGrants([row("vendors", { canView: true, canApprove: true })]);
    expect(set.has(permissionKey("vendors", "view"))).toBe(true);
    expect(set.has(permissionKey("vendors", "approve"))).toBe(true);
    expect(set.has(permissionKey("vendors", "add"))).toBe(false);
    expect(set.size).toBe(2);
  });

  test("all five verbs on one module map to all five keys", () => {
    const set = expandGrants([
      row("access", {
        canAdd: true,
        canEdit: true,
        canDelete: true,
        canView: true,
        canApprove: true,
      }),
    ]);
    for (const verb of RBAC_VERBS) expect(set.has(permissionKey("access", verb))).toBe(true);
    expect(set.size).toBe(RBAC_VERBS.length);
  });

  test("grants union across roles and dedupe overlaps", () => {
    // Two roles both grant vendors:view (dedupes to one) plus distinct grants that add up.
    const set = expandGrants([
      row("vendors", { canView: true }),
      row("vendors", { canView: true, canEdit: true }),
      row("documents", { canView: true }),
    ]);
    expect(set.has(permissionKey("vendors", "view"))).toBe(true);
    expect(set.has(permissionKey("vendors", "edit"))).toBe(true);
    expect(set.has(permissionKey("documents", "view"))).toBe(true);
    expect(set.size).toBe(3);
  });

  test("distinct modules stay distinct", () => {
    const rows = RBAC_MODULES.map((m) => row(m, { canView: true }));
    const set = expandGrants(rows);
    expect(set.size).toBe(RBAC_MODULES.length);
    for (const m of RBAC_MODULES) expect(set.has(permissionKey(m, "view"))).toBe(true);
  });
});
