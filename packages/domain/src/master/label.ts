/**
 * Master-data bilingual labels (M2.1, #32, ADR-0011).
 *
 * Master rows that name a *term* carry a per-locale label pair (`name_id` / `name_en` in `@vms/db`);
 * the UI renders the active locale and **falls back to the other locale when the requested one is
 * blank** (ADR-0011: "renders the active locale, falls back to the other if blank"). That fallback is
 * different from {@link translate}'s catalogue chain (requested → default → key): a master label is
 * runtime *data*, never a catalogue key, so a missing side degrades to the sibling locale, then "".
 *
 * Proper-name lists (banks, countries, currencies, vessels, ports) keep a single `name` and do **not**
 * use this — only localized *terms* do (business entities, categories, departments, Soechi entities…).
 *
 * This is the domain half of the master framework's "per-locale labels" contract; the API half is the
 * generic CRUD route (`masterListRoutes`) that validates the pair on write. Stack-neutral by design —
 * both the Hono API and the React shells resolve labels through {@link resolveLabel}.
 */

import { z } from "zod";
import { nonEmptyString } from "../schemas/common";
import type { Locale } from "../values/locale";

/** A stored master label in both supported locales. Mirrors a `name_id` / `name_en` column pair. */
export interface BilingualLabel {
  readonly id: string;
  readonly en: string;
}

/** Non-blank once trimmed — a label side is "present" only if it has visible characters. */
const present = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Render a {@link BilingualLabel} in `locale`, falling back to the *other* locale when the requested
 * side is blank, and finally to `""` (ADR-0011). Never returns a key — labels are data, not catalogue
 * entries. Use for every localized-term master row; single-`name` lists render their `name` directly.
 */
export const resolveLabel = (label: BilingualLabel, locale: Locale): string => {
  const [primary, secondary] = locale === "en" ? [label.en, label.id] : [label.id, label.en];
  if (present(primary)) return primary.trim();
  if (present(secondary)) return secondary.trim();
  return "";
};

/**
 * The Zod fields every localized-term master create/update body shares: a required, trimmed
 * `nameId` + `nameEn`, each capped at `max` (per-list, matching the column width in `@vms/db`).
 * Spread into a list's own `z.object({ ...bilingualLabelFields(120), category: ... })` so no list
 * hand-rolls the bilingual-label validation (M2.1's "shared convention" DoD).
 */
export const bilingualLabelFields = (max: number) => ({
  nameId: nonEmptyString.max(max),
  nameEn: nonEmptyString.max(max),
});

/** The same fields as an optional patch (every side optional) — for a master update body. */
export const bilingualLabelPatchFields = (max: number) => ({
  nameId: nonEmptyString.max(max).optional(),
  nameEn: nonEmptyString.max(max).optional(),
});

/** The write shape of a bilingual label — the `name_id` / `name_en` pair a master body carries. */
export type BilingualLabelInput = { readonly nameId: string; readonly nameEn: string };

/** A standalone schema for a bilingual label pair — handy where a nested label object is captured. */
export const bilingualLabelSchema = (max: number) => z.object(bilingualLabelFields(max));
