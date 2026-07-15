/**
 * Smoke tests for the domain substrate (M0.3). Run with `bun test`.
 * Not part of `tsc` typecheck (excluded in tsconfig) — Bun provides `bun:test` at runtime.
 */

import { describe, expect, test } from "bun:test";
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
