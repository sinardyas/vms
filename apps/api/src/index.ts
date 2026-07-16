import { db } from "@vms/db";
import { APP_NAME } from "@vms/domain";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { accessRoutes } from "./access-route";
import { approvalRoutes } from "./approval-route";
import { approvalRouteRoutes } from "./approval-routes-route";
import { auditRoutes } from "./audit-route";
import { auth } from "./auth";
import { type AppEnv, requestContext } from "./context";
import { devActorResolver } from "./dev-actor";
import { documentMasterRoutes } from "./document-master-route";
import { documentVerificationRoutes } from "./document-verification-route";
import { env } from "./env";
import { meRoutes } from "./me-route";
import { notificationRoutes } from "./notifications-route";
import { operationalListRoutes } from "./operational-lists-route";
import { registrationListRoutes } from "./registration-lists-route";
import { sessionActorResolver } from "./session-actor";
import { requireVendorOwnership } from "./vendor-access";
import { vendorBanksRoutes } from "./vendor-banks-route";
import { vendorChangeRoutes } from "./vendor-change-route";
import { vendorDocumentsRoutes } from "./vendor-documents-route";
import { vendorRoutes } from "./vendor-route";

const app = new Hono<AppEnv>();

// The SPAs (console :3002, portal :3000) call this API — including the auth endpoints — from another
// origin. Credentials must be allowed so the better-auth session cookie is sent and set cross-origin.
app.use("*", cors({ origin: env.corsOrigins, credentials: true }));

// better-auth owns everything under its base path (sign-up, verify, sign-in, session, reset). Mounted
// BEFORE the context middleware and terminal (returns a Response), so the per-request session lookup
// below never runs against better-auth's own routes.
app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Every other request carries a RequestContext (actor, locale, ip/ua) — the M0.4 cross-cutting seam
// the audit writer and RBAC guard read. The actor is now resolved from the real better-auth session
// (M1.1); the dev stand-in (#8) remains available only when `DEV_ACTOR` is explicitly on in a
// non-production env, so the walking skeleton still runs without a login.
app.use("*", requestContext(env.devActor ? devActorResolver : sessionActorResolver(db)));

app.get("/", (c) => c.text(`${APP_NAME} API — see /health`));

app.get("/health", (c) =>
  c.json({ ok: true, service: "vms-api", app: APP_NAME, env: env.nodeEnv }),
);

// Proves the @vms/db wiring end-to-end. Requires Postgres up; returns 503 if it can't connect,
// so the process itself boots fine without a database (the walking skeleton, #8, drives this).
app.get("/health/db", async (c) => {
  try {
    await db.execute(sql`select 1`);
    return c.json({ ok: true, db: "up" });
  } catch (error) {
    return c.json({ ok: false, db: "down", error: String(error) }, 503);
  }
});

// M1.3 (#22): the session's identity + capability grid — the server-authored mirror the UI reads to
// show/hide affordances. Computed from the same permission set the RBAC guard evaluates, so a hidden
// button is a refused request. 401 for an anonymous caller (deny-by-default).
app.route("/", meRoutes());

// M6.3 (#79, ADR-0016): the notification centre both bells read — self-scoped to the session's own
// rows, so like `meRoutes` it is authenticated-only rather than gated on an RBAC module, and mounted
// at "/" because both audiences (console + portal) share it rather than it being a console surface.
app.route("/", notificationRoutes());

// Walking skeleton (#8, M0.6): guard → audit write → DB read → JSON the console renders in @vms/ui.
app.route("/console", auditRoutes());

// M1.5 (#24): Access admin — Users/Roles CRUD + RBAC matrix editor, all gated on `access` and
// deadlock-guarded (ADR-0011b). Mounted under the same authenticated `/console` prefix.
app.route("/console/access", accessRoutes());

// M2.2 (#33): the five registration-list masters (business entities, vendor categories, banks,
// currencies, countries) vendor registration reads its dropdowns from — each a thin instantiation of
// the M2.1 master framework (#32), gated on `registration_lists` and audited atomically.
app.route("/console/registration-lists", registrationListRoutes());

// M2.3 (#34): Document Master — the compliance doc-type list (bilingual, origin `applies_to` +
// `mandatory`, active flag `enabled`) plus the M:N category-requirements matrix the M5.2 activation
// gate reads. Also a thin instantiation of the M2.1 framework, gated on `document_master`.
app.route("/console/document-master", documentMasterRoutes());

// M2.4 (#35): Approval Routes — the trigger→ordered-steps routing table the M4 engine resolves. The
// route header is a thin M2.1 instantiation (gated on `approval_routes`); the steps sub-router carries
// the deadlock guard (ADR-0011b) that warns, re-confirmably, before a save strands a step with no
// eligible approver (reusing the M1.5 eligibility count + M1.6 SoD primitive).
app.route("/console/approval-routes", approvalRouteRoutes());

// M4.2 (#57): Approval workflow engine — the queue/detail reads + approve/reject/reassign decisions
// that walk a submitted request through its route (resolved by trigger, ADR-0005). Requests are opened
// at submit (see the vendor route's store); this router acts on the open ones. Gated on `approvals`,
// every decision audited. SoD + escalation are M4.3; the M5.2 activation gate slots into the `activate`
// effect; M4.6 builds the console UX on these endpoints.
app.route("/console/approvals", approvalRoutes());

// M5.1 (#68): Document verification — the Document Verifier's queue + per-document verify/reject actions
// (issue/expiry entered/confirmed at verify, reason on reject), gated on the `documents` module
// (`documents:approve`, SoD-distinct from `approvals:approve`, ADR-0007/0014) and atomically audited.
// Acts only on current versions of Pending vendors; sets the verify state the M5.2 activation gate and
// the M5.3 reject→Draft/re-upload flow later read. Console UX is M5.4.
app.route("/console/document-verification", documentVerificationRoutes());

// M2.5 (#36): Operational lists — the six behaviorally-inert reference lists (departments, soechi
// entities, vessels, ports, tax codes, SLA thresholds) the console manages but nothing in Phase-0 acts
// on (ADR-0002). Each is a thin instantiation of the M2.1 framework, gated on `operational_lists` and
// audited atomically; `sla_thresholds` is captured but deliberately not enforced (config, not behaviour).
app.route("/console/operational-lists", operationalListRoutes());

// M3.5 (#46): own-vendor scoping — a vendor-kind actor may only reach a `:vendorId` they belong to
// (internal staff bypass, bounded by RBAC). Scoped to the bank/document sub-paths specifically (NOT a
// broad `/vendors/:vendorId/*`, whose `*` also matches `/vendors/me` and would bind vendorId="me" →
// a UUID error in the guard); the aggregate route enforces the same guard inline on its own
// read/edit/submit, and `/vendors/me` is the caller's own record so it needs no ownership check.
const vendorOwnership = requireVendorOwnership();
app.use("/vendors/:vendorId/banks", vendorOwnership);
app.use("/vendors/:vendorId/banks/*", vendorOwnership);
app.use("/vendors/:vendorId/documents", vendorOwnership);
app.use("/vendors/:vendorId/documents/*", vendorOwnership);
app.use("/vendors/:vendorId/change-requests", vendorOwnership);
app.use("/vendors/:vendorId/change-requests/*", vendorOwnership);

// M3.5 (#46): Vendor aggregate root — self-registration capture + submit (account-first, resumable
// Draft → Pending). `GET /vendors/me` resumes; `POST /vendors` creates a Draft + owner link; PUT saves
// leniently; `POST /vendors/:id/submit` runs the M3.4 whole-aggregate gate then transitions Draft→
// Pending, catching the `tax_id` partial-unique as a friendly 409. Gated on `vendors`, audited.
// Mounted at "/" (its handlers carry the full `/vendors/...` paths, like `meRoutes`), so it is NOT
// double-prefixed the way the relative-path bank/document sub-routers below are.
app.route("/", vendorRoutes());

// M3.2 (#43): Vendor bank accounts + attachments — the vendor-scoped bank block (CRUD + M:N currencies
// + MinIO proof/KTP/surat uploads with signed-URL reads), gated on `vendors`. Enforces the ADR-0013/0005
// invariants: exactly one primary per vendor, KTP+surat when the holder ≠ company, a remark when the
// bank's country differs from the vendor's. The shared bank-block Zod (`@vms/domain`) feeds M3.4's gate.
app.route("/vendors", vendorBanksRoutes());

// M3.3 (#44): Vendor compliance-document capture — `document_slots` + versioned `document_versions`,
// gated on `vendors`. Uploads land in MinIO through the shared M3.2 storage seam (validated, not gated,
// ADR-0013); reads are signed URLs. Re-uploading appends a version and moves the slot pointer (the M5.3
// shape). Issue/expiry + verify status are the verifier's at M5, so capture never records them. The
// shared `@vms/domain` doc block + completeness predicate feed M3.4's submit gate.
app.route("/vendors", vendorDocumentsRoutes());

// M4.5 (#60): Post-activation edits — an Active vendor's bank/non-bank change raised as an approvable
// diff (ADR-0005), routed by kind (bank → AP Manager, non-bank → AP Supervisor; ADR-0009), guarded by
// `change_pending`, applied only on final approval (`vendor-change.ts`, run in the approval decide tx).
// Gated on `vendors`, own-vendor scoped, audited.
app.route("/vendors", vendorChangeRoutes());

export default { port: env.port, fetch: app.fetch };
