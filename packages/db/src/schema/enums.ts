import { pgEnum } from "drizzle-orm/pg-core";

// Closed sets → Postgres enums (ADR-0015). Open/extensible sets are master-data tables.

/** Vendor origin drives required fields & documents (ADR-0004, 0013). */
export const originEnum = pgEnum("origin", ["local", "foreign"]);

/** Vendor lifecycle (ADR-0004, 0014). `blacklisted` reachable only via later Violations pillar. */
export const vendorStatusEnum = pgEnum("vendor_status", [
  "draft",
  "pending",
  "pending_hod",
  "active",
  "inactive",
  "blacklisted",
]);

/** How a vendor record was created (ADR-0002 hybrid onboarding). */
export const vendorSourceEnum = pgEnum("vendor_source", ["self", "office"]);

/** A user is either an external vendor user or an internal staff user (ADR-0004/0015). */
export const userKindEnum = pgEnum("user_kind", ["vendor", "internal"]);

/** RBAC permission subjects — grouped modules (ADR-0012). */
export const rbacModuleEnum = pgEnum("rbac_module", [
  "vendors",
  "documents",
  "approvals",
  "registration_lists",
  "operational_lists",
  "approval_routes",
  "document_master",
  "access",
  "audit",
]);

/** What an ApprovalRequest is about (ADR-0005, 0009). */
export const approvalTriggerEnum = pgEnum("approval_trigger", [
  "new_vendor_registration",
  "office_vendor_registration",
  "bank_change",
  "non_bank_change",
  "reactivation",
]);

/** ApprovalRequest status (ADR-0005, 0010). `recalled` = submitter withdrew pre-decision. */
export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "recalled",
]);

/** Per-step decision on an ApprovalRequest (ADR-0005). */
export const stepDecisionEnum = pgEnum("step_decision", ["pending", "approved", "rejected"]);

/** Compliance-document verification state (ADR-0007, 0011). */
export const verifyStatusEnum = pgEnum("verify_status", ["pending", "verified", "rejected"]);

/** Document Master origin applicability (ADR-0013). */
export const docAppliesToEnum = pgEnum("doc_applies_to", ["local", "foreign", "both"]);

/** Vendor payment terms captured at registration (design + ADR-0013). */
export const paymentTermEnum = pgEnum("payment_term", [
  "credit_30",
  "credit_45",
  "credit_60",
  "cod",
  "agent",
]);

/** Bank / business-entity locality (ADR-0006 naming guard, ADR-0013). */
export const localityEnum = pgEnum("locality", ["local", "foreign"]);

/** Notification delivery channel (ADR-0012). */
export const notificationChannelEnum = pgEnum("notification_channel", ["email", "in_app"]);
