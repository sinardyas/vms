/**
 * Shared value types (M0.3, ADR-0008) — the closed sets the whole system speaks in.
 *
 * These are the TypeScript source of truth for the domain's stable codes, drawn from
 * `docs/phase-0-domain-model.md`. They intentionally mirror the Postgres enums committed in
 * `@vms/db` (`schema/enums.ts`): the DB owns the column type, this file owns the code used by
 * the API, the validators, and both UIs. **Keep the two in lockstep** — a value added here
 * must be added to the matching `pgEnum`, and vice-versa. Domain stays stack-neutral, so it
 * does not import `@vms/db` (that would pull in Drizzle); the mirror is deliberate.
 *
 * Each set is exported three ways: a `readonly` tuple (iterate/seed), a union `type` (annotate),
 * and a Zod schema (validate). Human labels are NOT here — they are i18n keys (`enum.*`).
 */

import { z } from "zod";

/** Vendor origin — drives required fields & the document gate (ADR-0004, 0013). */
export const ORIGINS = ["local", "foreign"] as const;
export type Origin = (typeof ORIGINS)[number];
export const originSchema = z.enum(ORIGINS);

/** Vendor lifecycle (ADR-0004, 0014). `blacklisted` is reachable only via the later Violations pillar. */
export const VENDOR_STATUSES = [
  "draft",
  "pending",
  "pending_hod",
  "active",
  "inactive",
  "blacklisted",
] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];
export const vendorStatusSchema = z.enum(VENDOR_STATUSES);

/** How a vendor record was created (ADR-0002 hybrid onboarding). */
export const VENDOR_SOURCES = ["self", "office"] as const;
export type VendorSource = (typeof VENDOR_SOURCES)[number];
export const vendorSourceSchema = z.enum(VENDOR_SOURCES);

/** A user is either an external vendor user or an internal staff user (ADR-0004, 0015). */
export const USER_KINDS = ["vendor", "internal"] as const;
export type UserKind = (typeof USER_KINDS)[number];
export const userKindSchema = z.enum(USER_KINDS);

/** RBAC permission subjects — the 9 grouped modules (ADR-0012). */
export const RBAC_MODULES = [
  "vendors",
  "documents",
  "approvals",
  "registration_lists",
  "operational_lists",
  "approval_routes",
  "document_master",
  "access",
  "audit",
] as const;
export type RbacModule = (typeof RBAC_MODULES)[number];
export const rbacModuleSchema = z.enum(RBAC_MODULES);

/** RBAC verbs — the permission columns on `role_permissions` (ADR-0011). Consumed by M1's `can()`. */
export const RBAC_VERBS = ["add", "edit", "delete", "view", "approve"] as const;
export type RbacVerb = (typeof RBAC_VERBS)[number];
export const rbacVerbSchema = z.enum(RBAC_VERBS);

/** What an ApprovalRequest is about (ADR-0005, 0009). */
export const APPROVAL_TRIGGERS = [
  "new_vendor_registration",
  "office_vendor_registration",
  "bank_change",
  "non_bank_change",
  "reactivation",
] as const;
export type ApprovalTrigger = (typeof APPROVAL_TRIGGERS)[number];
export const approvalTriggerSchema = z.enum(APPROVAL_TRIGGERS);

/** ApprovalRequest status (ADR-0005, 0010). `recalled` = submitter withdrew pre-decision. */
export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "recalled"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export const approvalStatusSchema = z.enum(APPROVAL_STATUSES);

/** Per-step decision on an ApprovalRequest (ADR-0005). */
export const STEP_DECISIONS = ["pending", "approved", "rejected"] as const;
export type StepDecision = (typeof STEP_DECISIONS)[number];
export const stepDecisionSchema = z.enum(STEP_DECISIONS);

/** Compliance-document verification state (ADR-0007, 0011). */
export const VERIFY_STATUSES = ["pending", "verified", "rejected"] as const;
export type VerifyStatus = (typeof VERIFY_STATUSES)[number];
export const verifyStatusSchema = z.enum(VERIFY_STATUSES);

/** Document Master origin applicability (ADR-0013). */
export const DOC_APPLIES_TO = ["local", "foreign", "both"] as const;
export type DocAppliesTo = (typeof DOC_APPLIES_TO)[number];
export const docAppliesToSchema = z.enum(DOC_APPLIES_TO);

/** Vendor payment terms captured at registration (design + ADR-0013). */
export const PAYMENT_TERMS = ["credit_30", "credit_45", "credit_60", "cod", "agent"] as const;
export type PaymentTerm = (typeof PAYMENT_TERMS)[number];
export const paymentTermSchema = z.enum(PAYMENT_TERMS);

/** Bank / business-entity locality (ADR-0006 naming guard, ADR-0013). */
export const LOCALITIES = ["local", "foreign"] as const;
export type Locality = (typeof LOCALITIES)[number];
export const localitySchema = z.enum(LOCALITIES);

/** Notification delivery channel (ADR-0012). */
export const NOTIFICATION_CHANNELS = ["email", "in_app"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
