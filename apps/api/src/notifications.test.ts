import { describe, expect, test } from "bun:test";
import type { NotificationInput } from "@vms/domain";
import {
  type NotificationRecipient,
  type NotifyDeps,
  type NotifyRequest,
  notify,
  writeInAppNotification,
} from "./notifications";

const vendor: NotificationRecipient = {
  userId: "u-vendor",
  email: "budi@samudra.test",
  name: "Budi",
  locale: "id",
  kind: "vendor",
  active: true,
};

const staff: NotificationRecipient = {
  userId: "u-staff",
  email: "siti@soechi.test",
  name: "Siti",
  locale: "en",
  kind: "internal",
  active: true,
};

/** A deps double recording what each channel was handed, with per-channel failure injection. */
const harness = (
  recipient: NotificationRecipient | null,
  fail?: { inApp?: boolean; email?: boolean },
) => {
  const inApp: NotificationInput[] = [];
  const emails: { to: NotificationRecipient; input: NotificationInput }[] = [];
  const deps: NotifyDeps = {
    loadRecipient: async () => recipient,
    writeInApp: async (_r, input) => {
      if (fail?.inApp) throw new Error("db down");
      inApp.push(input);
    },
    sendEmail: async (r, input) => {
      if (fail?.email) throw new Error("smtp down");
      emails.push({ to: r, input });
    },
  };
  return { deps, inApp, emails };
};

const decisionFor = (to: string): NotifyRequest<"decision"> => ({
  to,
  event: "decision",
  params: {
    url: "https://portal.test/registration",
    vendorName: "PT Samudra",
    outcome: "rejected",
    reason: "NPWP tidak sesuai",
  },
});

describe("notify — channel policy by audience (ADR-0016, superseding ADR-0012)", () => {
  test("a vendor gets an in-app row as well as the email", async () => {
    const { deps, inApp, emails } = harness(vendor);
    const outcome = await notify(decisionFor(vendor.userId), deps);
    // Was email-only under ADR-0012. The row is what survives a lost inbox, and it's what fills the
    // portal bell (M6.3) — dispatch didn't change, the policy did.
    expect(outcome).toEqual({ delivered: ["in_app", "email"], failed: [] });
    expect(emails).toHaveLength(1);
    expect(inApp).toHaveLength(1);
  });

  test("an internal user gets both an in-app row and an email", async () => {
    const { deps, inApp, emails } = harness(staff);
    const outcome = await notify(
      {
        to: staff.userId,
        event: "step_assigned",
        params: {
          url: "https://console.test/approvals/1",
          vendorName: "PT Samudra",
          roleName: "AP Supervisor",
        },
      },
      deps,
    );
    expect(outcome).toEqual({ delivered: ["in_app", "email"], failed: [] });
    expect(inApp).toHaveLength(1);
    expect(emails).toHaveLength(1);
  });
});

describe("notify — recipient resolution", () => {
  test("the recipient's own name is folded into the params, not the caller's", async () => {
    const { deps, emails } = harness(vendor);
    await notify(decisionFor(vendor.userId), deps);
    expect(emails[0]?.input.params.name).toBe("Budi");
  });

  test("renders in the recipient's locale, which is the point of users.locale", async () => {
    // The staff recipient reads `en`; nothing about the request said so.
    const { deps, emails } = harness(staff);
    await notify(decisionFor(staff.userId), deps);
    expect(emails[0]?.to.locale).toBe("en");
  });

  test("an unknown recipient is skipped, not delivered", async () => {
    const { deps, emails } = harness(null);
    const outcome = await notify(decisionFor("nobody"), deps);
    expect(outcome).toEqual({ delivered: [], failed: [], skipped: "unknown-recipient" });
    expect(emails).toHaveLength(0);
  });

  test("a deactivated user is skipped — their bell is unreachable and mail is noise", async () => {
    const { deps, emails } = harness({ ...vendor, active: false });
    const outcome = await notify(decisionFor(vendor.userId), deps);
    expect(outcome).toEqual({ delivered: [], failed: [], skipped: "inactive-recipient" });
    expect(emails).toHaveLength(0);
  });

  test("a recipient lookup that throws degrades to a skip, never a throw", async () => {
    const deps: NotifyDeps = {
      loadRecipient: async () => {
        throw new Error("db down");
      },
      writeInApp: async () => {},
      sendEmail: async () => {},
    };
    expect(await notify(decisionFor("u"), deps)).toEqual({
      delivered: [],
      failed: [],
      skipped: "unknown-recipient",
    });
  });
});

describe("notify — validation", () => {
  test("params failing the event's schema are skipped before anything is sent", async () => {
    const { deps, emails } = harness(vendor);
    const outcome = await notify(
      {
        to: vendor.userId,
        event: "decision",
        // A rejection with no reason — sending it would ship a literal `{reason}` to the vendor.
        params: { url: "https://portal.test/x", vendorName: "PT Samudra", outcome: "rejected" },
      },
      deps,
    );
    expect(outcome).toEqual({ delivered: [], failed: [], skipped: "invalid-params" });
    expect(emails).toHaveLength(0);
  });
});

describe("notify — failures never reach the caller", () => {
  test("an SMTP failure is reported, not thrown — the state change already committed", async () => {
    const { deps } = harness(vendor, { email: true });
    // The assertion is really that this line resolves at all: a throw would 500 a request whose work
    // had already committed, leaving the caller unable to tell a failed delivery from a failed change.
    const outcome = await notify(decisionFor(vendor.userId), deps);
    expect(outcome).toEqual({ delivered: ["in_app"], failed: ["email"] });
  });

  test("channels are independent — a dead SMTP host still leaves the in-app row", async () => {
    const { deps, inApp } = harness(staff, { email: true });
    const outcome = await notify(decisionFor(staff.userId), deps);
    expect(outcome).toEqual({ delivered: ["in_app"], failed: ["email"] });
    expect(inApp).toHaveLength(1);
  });

  test("and the converse — a failed in-app write still sends the email", async () => {
    const { deps, emails } = harness(staff, { inApp: true });
    const outcome = await notify(decisionFor(staff.userId), deps);
    expect(outcome).toEqual({ delivered: ["email"], failed: ["in_app"] });
    expect(emails).toHaveLength(1);
  });
});

describe("writeInAppNotification — the tx-rideable primitive", () => {
  const input: NotificationInput = {
    event: "step_assigned",
    params: {
      name: "Siti",
      url: "https://console.test/approvals/1",
      vendorName: "PT Samudra",
      roleName: "AP Supervisor",
    },
  };

  test("stores keys and params, never rendered copy, so M6.3 can re-render per locale", async () => {
    let values: Record<string, unknown> | undefined;
    const sink = {
      insert: () => ({
        values: async (v: Record<string, unknown>) => {
          values = v;
        },
      }),
    };
    // biome-ignore lint/suspicious/noExplicitAny: a minimal insert double, not a real Drizzle handle.
    await writeInAppNotification(sink as any, "u-staff", input);

    expect(values).toMatchObject({
      userId: "u-staff",
      event: "step_assigned",
      channel: "in_app",
      titleKey: "notify.stepAssigned.title",
      bodyKey: "notify.stepAssigned.body",
      link: "https://console.test/approvals/1",
    });
    // The params ride along so the row can be re-rendered in whichever language its reader picks.
    expect(values?.params).toEqual(input.params);
  });

  test("takes any insert handle, so a caller can pass its open transaction", async () => {
    // The whole reason it takes a sink instead of importing `db` (cf. writeAudit).
    const calls: string[] = [];
    const tx = {
      insert: () => ({
        values: async () => {
          calls.push("insert");
        },
      }),
    };
    // biome-ignore lint/suspicious/noExplicitAny: a minimal insert double, not a real Drizzle handle.
    await writeInAppNotification(tx as any, "u-staff", input);
    expect(calls).toEqual(["insert"]);
  });
});
