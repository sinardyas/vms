/**
 * Vendor aggregate-root block — the shared Zod + per-origin required-field spec (M3.4, #45,
 * ADR-0004/0010/0013).
 *
 * The single source of truth for the vendor *profile* (identity + address + people + payment terms —
 * the M3.1 columns on `vendors`) and, crucially, for **what "required" means at each stage of the
 * Draft→submit lifecycle**. Both the portal (M3.5) and the office-registration API (M3.6) import this
 * so a self-registered and a staff-created vendor are held to the *same* bar.
 *
 * Two stages, kept deliberately apart (ADR-0004 — Draft is a first-class, resumable state):
 *   - **save-Draft (lenient)** — {@link vendorDraftInput}: structural shape + caps only. Everything
 *     but `origin`/`source`/`name` is optional, so a half-filled Draft round-trips without complaint.
 *   - **submit (strict)** — {@link vendorSubmitSchema}: the same shape, but every field in the
 *     per-origin required set ({@link VENDOR_SUBMIT_REQUIRED}) must be present. This is only the
 *     *profile* half of submit-completeness; the banks + documents halves are composed on top of it
 *     in {@link ./vendor-submit} (the whole-aggregate gate).
 *
 * The required set is **per origin** (ADR-0004): a local vendor must supply its Indonesian tax
 * identity (NPWP + PKP status + NPWP sub-type + SIUP scale — the drift-audit #4 P0 fields), a foreign
 * vendor need not (its `taxId` is unique-if-present, and the PKP/NPWP concepts are Indonesia-only).
 * The spec is declarative so the portal can drive its required-field markers from the *same* list the
 * gate enforces — no drift between what the form stars and what submit rejects.
 */

import { z } from "zod";
import type { Origin } from "../values/enums";
import {
  companyScaleSchema,
  npwpTypeSchema,
  originSchema,
  paymentTermSchema,
  taxStatusSchema,
  vendorSourceSchema,
} from "../values/enums";
import { emailSchema, uuidSchema } from "./common";

/** A trimmed, non-empty, length-capped string (matches a `varchar(max)` column). */
const str = (max: number) => z.string().trim().min(1).max(max);

/**
 * The structural shape of the vendor profile as captured — every M3.1 column on `vendors` a screen
 * fills in, minus the server-managed ones (`id`/`status`/`shortCode`/`changePending`/timestamps). Only
 * `origin`, `source`, and `name` are required here: they are known the instant a Draft is created and a
 * Draft can't exist without them. Everything else is optional so a partial Draft save always validates;
 * the *submit* bar is layered on separately ({@link vendorSubmitSchema}), never baked into this shape.
 */
export const vendorDraftInput = z.object({
  // lifecycle-defining (always present, even in an empty Draft)
  origin: originSchema, // local | foreign — drives the required set + the document gate
  source: vendorSourceSchema, // self (portal) | office (console)
  name: str(240),

  // identity
  businessEntityId: uuidSchema.optional(),
  categoryId: uuidSchema.optional(), // single category — also drives the required document set
  taxId: str(40).optional(), // NPWP (local) | VAT/BRN (foreign); blank in Draft
  taxStatus: taxStatusSchema.optional(), // PKP × taxpayer-type (drift #4 P0) — required at submit, local only
  npwpType: npwpTypeSchema.optional(), // personal | head-office | branch (drift #4)
  companyScale: companyScaleSchema.optional(), // kecil | menengah | besar per SIUP (drift #4 P1)
  procurementNote: str(200).optional(), // free-text; drives nothing in Phase-0 (E-Proc is Phase-2)

  // profile
  address: str(2000).optional(), // `text` column
  city: str(120).optional(),
  postal: str(20).optional(),
  countryId: uuidSchema.optional(),
  phone: str(40).optional(),
  fax: str(40).optional(),
  yearFounded: z.number().int().gte(1800).lte(2155).optional(),
  website: str(200).optional(),
  email: emailSchema.optional(),

  // people
  commissioner: str(200).optional(),
  director: str(200).optional(),
  picName: str(200).optional(),
  picRole: str(160).optional(),
  picPhone: str(40).optional(), // WhatsApp
  picEmail: emailSchema.optional(),
  soechiReference: str(200).optional(),

  // payment terms + signed-terms attachment (validated, not gated — ADR-0013)
  paymentTerm: paymentTermSchema.optional(),
  signedTermsFileId: uuidSchema.optional(),
});
export type VendorDraftInput = z.infer<typeof vendorDraftInput>;

/* ── Per-origin required-field set — the single source both the gate and the portal read ─────────── */

/** Required at submit for **every** vendor, whatever its origin (ADR-0004; category drives the doc gate). */
const REQUIRED_COMMON = [
  "businessEntityId",
  "categoryId",
  "address",
  "city",
  "countryId",
  "phone",
  "picName",
  "picPhone",
  "picEmail",
  "paymentTerm",
] as const satisfies readonly (keyof VendorDraftInput)[];

/**
 * The profile fields that must be present to leave Draft, keyed by origin. `origin`/`source`/`name` are
 * absent because the base schema already requires them. Local adds its Indonesian tax identity (NPWP +
 * PKP status + NPWP sub-type + SIUP scale); foreign carries none of those (ADR-0004 — foreign `taxId` is
 * optional, and PKP/NPWP are Indonesia-only concepts). This list is what the M3.5 form stars and what
 * {@link vendorSubmitSchema} / the whole-aggregate gate enforce — one source, no drift.
 */
export const VENDOR_SUBMIT_REQUIRED = {
  local: [...REQUIRED_COMMON, "taxId", "taxStatus", "npwpType", "companyScale"],
  foreign: [...REQUIRED_COMMON],
} as const satisfies Record<Origin, readonly (keyof VendorDraftInput)[]>;

/** A vendor profile as the gate reads it — a parsed Draft *or* a DB row (nulls allowed alongside undefined). */
export type VendorProfileValues = {
  readonly [K in keyof VendorDraftInput]?: VendorDraftInput[K] | null;
};

/** A value counts as "supplied" unless it is null, undefined, or a blank/whitespace-only string. */
export const isFieldPresent = (value: unknown): boolean =>
  value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "");

/**
 * Which required profile fields are still missing for this origin — the profile half of submit-
 * completeness. Returns the field *codes* (not booleans) so callers can name exactly what's blocking
 * submission and light up the matching form fields.
 */
export const missingProfileFields = (origin: Origin, profile: VendorProfileValues): string[] =>
  VENDOR_SUBMIT_REQUIRED[origin].filter((field) => !isFieldPresent(profile[field]));

/**
 * The **strict** profile schema: the Draft shape plus the per-origin required-field rule. Every missing
 * required field surfaces as a Zod issue pathed at that field, so `parseWith(vendorSubmitSchema, body)`
 * yields a validation {@link DomainError} whose `details` name the gaps. The required set is chosen by
 * the payload's own `origin`, so one schema covers both. Use this for a parse-based profile check; use
 * the whole-aggregate gate in {@link ./vendor-submit} when banks + documents must be judged too.
 */
export const vendorSubmitSchema = vendorDraftInput.superRefine((profile, ctx) => {
  for (const field of missingProfileFields(profile.origin, profile)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [field],
      message: `${field} is required to submit the registration`,
    });
  }
});
