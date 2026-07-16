/**
 * Event-wiring tests (M6.2, #78) — the label resolution every notification's copy depends on.
 *
 * The dispatch helpers themselves (`notifyDecision`/`notifyDocRejected`/`notifyStepAssigned`) are
 * Drizzle reads plus a `notify()` call, and are proven live against Postgres + Mailpit where the
 * joins are real. What *is* worth pinning here is {@link labelFor}: it decides which language a
 * document or role is named in, and it's the one place where a blank master row could silently put a
 * hole in an email.
 */

import { describe, expect, test } from "bun:test";
import { labelFor } from "./notification-events";

const both = { nameId: "Akta Pendirian", nameEn: "Deed of Establishment" };

describe("labelFor — naming a master row in the recipient's language", () => {
  test("renders the requested locale", () => {
    expect(labelFor(both, "id", "notify.fallback.document")).toBe("Akta Pendirian");
    expect(labelFor(both, "en", "notify.fallback.document")).toBe("Deed of Establishment");
  });

  test("falls back to the sibling locale when the requested one is blank (M2.1 rule)", () => {
    // A half-translated master row must still name the document — in the other language rather than
    // not at all, which is what `resolveLabel` does for the console too.
    expect(
      labelFor({ nameId: "Akta Pendirian", nameEn: "" }, "en", "notify.fallback.document"),
    ).toBe("Akta Pendirian");
    expect(labelFor({ nameId: null, nameEn: "Deed" }, "id", "notify.fallback.document")).toBe(
      "Deed",
    );
  });

  test("blank in both languages falls back to the catalogue's generic noun, per locale", () => {
    // The templates require a non-empty documentName. Without this the vendor would read "the  for
    // PT X was rejected" — so the fallback is what keeps a bad master row from becoming bad copy.
    const blank = { nameId: null, nameEn: null };
    expect(labelFor(blank, "id", "notify.fallback.document")).toBe("dokumen tersebut");
    expect(labelFor(blank, "en", "notify.fallback.document")).toBe("the document");
  });

  test("a missing label at all is treated as blank, not a crash", () => {
    expect(labelFor(null, "en", "notify.fallback.role")).toBe("approval");
  });
});
