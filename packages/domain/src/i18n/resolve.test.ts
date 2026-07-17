/**
 * i18n resolution tests (M6.5 — i18n key audit). Run with `bun test`.
 *
 * The console and portal render enum values by building the key at the call site —
 * `t(`enum.paymentTerm.${value}` as MessageKey)`. That cast leaves the `MessageKey` union,
 * so a value with no catalogue entry compiles cleanly and only fails when the screen mounts.
 * These tests close that hole from both ends: every enum value a screen can render has an
 * entry, and an entry that slips through anyway degrades to the key instead of throwing.
 */

import { describe, expect, test } from "bun:test";
import {
  APPROVAL_STATUSES,
  APPROVAL_TRIGGERS,
  COMPANY_SCALES,
  DOC_APPLIES_TO,
  LOCALITIES,
  NPWP_TYPES,
  ORIGINS,
  PAYMENT_TERMS,
  RBAC_MODULES,
  RBAC_VERBS,
  STEP_DECISIONS,
  TAX_STATUSES,
  VENDOR_STATUSES,
  VERIFY_STATUSES,
} from "../values/enums";
import { LOCALES } from "../values/locale";
import { catalogue } from "./keys";
import { isMessageKey, translate } from "./resolve";

/** Every `enum.*` prefix a screen builds dynamically, paired with the values it renders. */
const DYNAMIC_ENUM_PREFIXES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["enum.origin", ORIGINS],
  ["enum.vendorStatus", VENDOR_STATUSES],
  ["enum.taxStatus", TAX_STATUSES],
  ["enum.npwpType", NPWP_TYPES],
  ["enum.companyScale", COMPANY_SCALES],
  ["enum.paymentTerm", PAYMENT_TERMS],
  ["enum.locality", LOCALITIES],
  ["enum.appliesTo", DOC_APPLIES_TO],
  ["enum.verifyStatus", VERIFY_STATUSES],
  ["enum.approvalTrigger", APPROVAL_TRIGGERS],
  ["enum.approvalStatus", APPROVAL_STATUSES],
  ["enum.stepDecision", STEP_DECISIONS],
  ["enum.rbacModule", RBAC_MODULES],
  ["enum.rbacVerb", RBAC_VERBS],
];

describe("dynamic enum labels", () => {
  for (const [prefix, values] of DYNAMIC_ENUM_PREFIXES) {
    test(`${prefix} has an entry for every value`, () => {
      const missing = values.filter((value) => !isMessageKey(`${prefix}.${value}`));
      expect(missing).toEqual([]);
    });

    test(`${prefix} renders non-empty text in every locale`, () => {
      for (const value of values) {
        const key = `${prefix}.${value}`;
        for (const locale of LOCALES) {
          const text = translate(key as Parameters<typeof translate>[0], locale);
          // Falling back to the key itself is the failure mode this guards.
          expect(text).not.toBe(key);
          expect(text.trim()).not.toBe("");
        }
      }
    });
  }
});

describe("translate", () => {
  test("degrades to the key when the entry is unknown", () => {
    const unknown = "enum.paymentTerm.does_not_exist" as Parameters<typeof translate>[0];
    expect(() => translate(unknown)).not.toThrow();
    expect(translate(unknown)).toBe("enum.paymentTerm.does_not_exist");
  });

  test("every catalogue entry carries both locales", () => {
    const blank = Object.entries(catalogue).filter(
      ([, entry]) => entry.id.trim() === "" || entry.en.trim() === "",
    );
    expect(blank.map(([key]) => key)).toEqual([]);
  });
});
