import { describe, expect, test } from "bun:test";
import { catalogue } from "../i18n";
import { LOCALES } from "../values";
import { channelsFor, hasInAppChannel } from "./channels";
import { NOTIFICATION_EVENTS, notificationEventSchema } from "./events";
import {
  type NotificationInput,
  notificationInputSchema,
  renderNotification,
  resolveTemplate,
} from "./templates";

// A valid input per event, reused across the template/render suites below.
const decision = (
  outcome: "approved" | "rejected",
  reason?: string,
  kind: "registration" | "reactivation" = "registration",
): NotificationInput => ({
  event: "decision",
  params: {
    name: "Budi",
    url: "https://portal.test/x",
    vendorName: "PT Samudra",
    outcome,
    kind,
    reason,
  },
});

/** The M6.4 reactivation register of the same event (M6.5e). */
const reactivation = (outcome: "approved" | "rejected", reason?: string): NotificationInput =>
  decision(outcome, reason, "reactivation");

const docRejected = (returnedToDraft: boolean): NotificationInput => ({
  event: "doc_rejected",
  params: {
    name: "Budi",
    url: "https://portal.test/x",
    vendorName: "PT Samudra",
    documentName: "Akta Pendirian",
    reason: "Halaman terakhir tidak terbaca",
    returnedToDraft,
  },
});

const ALL_INPUTS: readonly NotificationInput[] = [
  { event: "email_verify", params: { name: "Budi", url: "https://portal.test/v" } },
  decision("approved"),
  decision("rejected", "NPWP tidak sesuai"),
  reactivation("approved"),
  reactivation("rejected", "SIUP kedaluwarsa"),
  docRejected(true),
  docRejected(false),
  {
    event: "step_assigned",
    params: {
      name: "Siti",
      url: "https://console.test/a",
      vendorName: "PT Samudra",
      roleName: "AP Supervisor",
    },
  },
  {
    event: "office_invite",
    params: { name: "Budi", url: "https://portal.test/i", vendorName: "PT Samudra" },
  },
];

describe("event catalogue (ADR-0012)", () => {
  test("enumerates exactly the five Phase-0 events", () => {
    expect([...NOTIFICATION_EVENTS]).toEqual([
      "email_verify",
      "decision",
      "doc_rejected",
      "step_assigned",
      "office_invite",
    ]);
  });

  test("the schema rejects an event outside the catalogue", () => {
    // `notifications.event` is a varchar, not a pg enum — this schema is the only thing between a
    // typo'd event and the column.
    expect(notificationEventSchema.safeParse("vendor_activated").success).toBe(false);
  });
});

describe("channel policy (ADR-0016, superseding ADR-0012)", () => {
  test("internal users get in-app and email", () => {
    expect(channelsFor("internal")).toEqual(["in_app", "email"]);
    expect(hasInAppChannel("internal")).toBe(true);
  });

  test("vendors get in-app and email too — email reaches them, the row is the durable record", () => {
    // ADR-0012 sent vendors email *only*, which left the audience least likely to be looking at the
    // app with the most perishable channel and nothing to come back to. ADR-0016 gave them the row;
    // they did not lose the email.
    expect(channelsFor("vendor")).toEqual(["in_app", "email"]);
    expect(hasInAppChannel("vendor")).toBe(true);
  });

  test("every audience accumulates in-app rows, so neither bell is ever empty by policy", () => {
    // The policy — not the caller — decides the channels, which is why flipping it was enough to
    // give the portal a real feed without touching a single M6.2 call site.
    for (const kind of ["vendor", "internal"] as const) {
      expect(hasInAppChannel(kind)).toBe(true);
    }
  });
});

describe("params validation", () => {
  test("a rejection decision must carry a reason (ADR-0012 reject-with-reasons)", () => {
    const parsed = notificationInputSchema.safeParse(decision("rejected"));
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toContain("reason");
  });

  test("an approval needs no reason", () => {
    expect(notificationInputSchema.safeParse(decision("approved")).success).toBe(true);
  });

  test("every event's params are accepted when complete", () => {
    for (const input of ALL_INPUTS) {
      expect(notificationInputSchema.safeParse(input).success).toBe(true);
    }
  });

  test("params of the wrong event's shape are rejected", () => {
    // `step_assigned` needs a roleName; the discriminated union must not let a decision's shape pass.
    expect(
      notificationInputSchema.safeParse({
        event: "step_assigned",
        params: { name: "Siti", url: "https://console.test/a", vendorName: "PT Samudra" },
      }).success,
    ).toBe(false);
  });
});

describe("template resolution", () => {
  test("email_verify reuses the M1.1 auth keys, so M6.2's re-point can't drift", () => {
    expect(resolveTemplate(ALL_INPUTS[0] as NotificationInput)).toEqual({
      subjectKey: "auth.email.verify.subject",
      titleKey: "auth.email.verify.heading",
      bodyKey: "auth.email.verify.body",
      ctaKey: "auth.email.verify.cta",
    });
  });

  test("an approved and a rejected decision resolve to different copy", () => {
    expect(resolveTemplate(decision("approved")).subjectKey).not.toBe(
      resolveTemplate(decision("rejected", "x")).subjectKey,
    );
  });

  test("all four decision registers are distinct copy (M6.5e)", () => {
    // 2×2 — the kind must select copy just as firmly as the outcome does. Sharing a template across
    // kinds is exactly what M6.4 refused to do, and the reason it sent nothing at all.
    const keys = [
      decision("approved"),
      decision("rejected", "x"),
      reactivation("approved"),
      reactivation("rejected", "x"),
    ].map((i) => resolveTemplate(i).subjectKey);
    expect(new Set(keys).size).toBe(4);
  });

  test("a declined reactivation never claims a return to Draft, nor offers to resume (M6.4/M6.5e)", () => {
    // The bug M6.4 suppressed this notice to avoid, now asserted rather than avoided: a dormant
    // vendor was never in Draft to be returned to, and reactivation is staff-only — so copy that
    // says either would be false and unwalkable. This is the whole reason `kind` exists.
    for (const locale of LOCALES) {
      const rendered = renderNotification(reactivation("rejected", "SIUP kedaluwarsa"), locale);
      const registration = renderNotification(decision("rejected", "SIUP kedaluwarsa"), locale);
      for (const text of [rendered.subject, rendered.title, rendered.body, rendered.cta]) {
        expect(text.toLowerCase()).not.toContain("draft");
      }
      expect(rendered.cta).not.toBe(registration.cta);
      // …and it must say what *is* true: the vendor stays out of service.
      expect(rendered.body.toLowerCase()).toContain(
        locale === "id" ? "nonaktif" : "remains inactive",
      );
    }
  });

  test("an approved reactivation reads as a return to service, not a first approval (M6.5e)", () => {
    for (const locale of LOCALES) {
      const rendered = renderNotification(reactivation("approved"), locale);
      const registration = renderNotification(decision("approved"), locale);
      expect(rendered.subject).not.toBe(registration.subject);
      expect(rendered.body.toLowerCase()).toContain(
        locale === "id" ? "reaktivasi" : "reactivation",
      );
    }
  });

  test("a mandatory doc rejection resolves to different copy than an optional one (M5.3)", () => {
    // The mandatory one must say the registration went back to Draft; the optional one must not.
    expect(resolveTemplate(docRejected(true)).bodyKey).toBe("notify.docRejected.mandatory.body");
    expect(resolveTemplate(docRejected(false)).bodyKey).toBe("notify.docRejected.optional.body");
  });

  test("every template's keys exist in the catalogue, in both locales", () => {
    for (const input of ALL_INPUTS) {
      const template = resolveTemplate(input);
      for (const key of [
        template.subjectKey,
        template.titleKey,
        template.bodyKey,
        template.ctaKey,
      ]) {
        expect(catalogue[key]).toBeDefined();
        expect(catalogue[key].id.length).toBeGreaterThan(0);
        expect(catalogue[key].en.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("rendering", () => {
  test("renders every event in every locale with no unresolved {tokens}", () => {
    // Unmatched tokens survive interpolation verbatim, so a literal `{` in output means a template
    // interpolates a param its schema doesn't require — the failure this guards.
    for (const input of ALL_INPUTS) {
      for (const locale of LOCALES) {
        const rendered = renderNotification(input, locale);
        for (const text of [rendered.subject, rendered.title, rendered.body, rendered.cta]) {
          expect(text.length).toBeGreaterThan(0);
          expect(text).not.toContain("{");
        }
      }
    }
  });

  test("interpolates the recipient, vendor and reason into the body", () => {
    const body = renderNotification(decision("rejected", "NPWP tidak sesuai"), "en").body;
    expect(body).toContain("Budi");
    expect(body).toContain("PT Samudra");
    expect(body).toContain("NPWP tidak sesuai");
  });

  test("the locale selects the language — the same input reads differently in id and en", () => {
    const input = decision("approved");
    expect(renderNotification(input, "id").subject).not.toBe(
      renderNotification(input, "en").subject,
    );
    expect(renderNotification(input, "en").title).toBe("Registration approved");
    expect(renderNotification(input, "id").title).toBe("Pendaftaran disetujui");
  });
});
