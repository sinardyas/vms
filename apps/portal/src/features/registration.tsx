/**
 * Vendor Portal — self-registration wizard (M3.5, #46, ADR-0004/0010/0013).
 *
 * The account-first, **resumable** Draft: on entry we `getMe` — no vendor yet ⇒ a start panel (pick
 * origin + name ⇒ create a Draft); an existing Draft ⇒ the multi-section wizard, pre-filled; an
 * already-submitted vendor ⇒ the read-only status view. Every section's "Save draft" persists via PUT,
 * so leaving and returning keeps the data (the whole point of a first-class Draft).
 *
 * The four sections mirror the prototype: Company (profile + tax + PIC), Banks (M3.2), Documents (M3.3),
 * and Review. Required-field markers are driven off `VENDOR_SUBMIT_REQUIRED[origin]` from `@vms/domain`
 * — the *same* list the submit gate enforces, so what the form stars is exactly what submission needs.
 * Review runs `checkVendorSubmittable` client-side to enable Submit and list the outstanding blockers,
 * then calls the submit endpoint; the tax-id duplicate comes back as a friendly, prominent 409.
 */

import {
  COMPANY_SCALES,
  type MessageKey,
  NPWP_TYPES,
  PAYMENT_TERMS,
  type SubmitReadiness,
  TAX_STATUSES,
  VENDOR_SUBMIT_REQUIRED,
  type VendorSubmissionCandidate,
  checkVendorSubmittable,
  resolveLabel,
} from "@vms/domain";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  StatusPill,
  type StatusPillProps,
  useLocale,
  useT,
  useToast,
  verifyStatusTone,
} from "@vms/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PortalApiError } from "../lib/api";
import {
  type BankDTO,
  type BilingualRow,
  type CountryRow,
  type CurrencyRow,
  type RequiredDocumentDTO,
  type VendorDTO,
  type VendorDecisionDTO,
  type VendorDraftPayload,
  banksApi,
  docsApi,
  listsApi,
  vendorApi,
} from "../lib/vendor";

const SELECT_CLASS =
  "h-11 w-full rounded-xl border border-input bg-card px-3.5 text-sm font-medium text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/30";

/** The dropdown masters the form reads — loaded once, re-loaded on locale change. */
type Lists = {
  categories: BilingualRow[];
  entities: BilingualRow[];
  countries: CountryRow[];
  currencies: CurrencyRow[];
};

const useLists = (): Lists | null => {
  const { locale } = useLocale();
  const [lists, setLists] = useState<Lists | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([
      listsApi.categories(locale),
      listsApi.businessEntities(locale),
      listsApi.countries(locale),
      listsApi.currencies(locale),
    ])
      .then(([categories, entities, countries, currencies]) => {
        if (alive) setLists({ categories, entities, countries, currencies });
      })
      .catch(() => {
        if (alive) setLists({ categories: [], entities: [], countries: [], currencies: [] });
      });
    return () => {
      alive = false;
    };
  }, [locale]);
  return lists;
};

/* ── Entry point: resume, start, or show status ───────────────────────────────────────────────── */

export function Registration({ documentsOnly = false }: { documentsOnly?: boolean }) {
  const { locale } = useLocale();
  const t = useT();
  const [vendor, setVendor] = useState<VendorDTO | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    vendorApi
      .getMe(locale)
      .then((v) => setVendor(v))
      .catch(() => setVendor(null))
      .finally(() => setLoading(false));
  }, [locale]);

  useEffect(() => load(), [load]);

  if (loading) return <Centered>{t("portal.common.loading")}</Centered>;
  if (!vendor) return <StartPanel onCreated={setVendor} />;
  if (vendor.status !== "draft") return <StatusView vendor={vendor} />;
  if (documentsOnly) return <DocumentsSection vendor={vendor} />;
  return <Wizard vendor={vendor} onChange={setVendor} onSubmitted={load} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-64 items-center justify-center text-muted-foreground">{children}</div>
  );
}

/**
 * What the vendor has to act on, read from the **record** (M6.3, ADR-0016).
 *
 * Deliberately not a notification feed — that's the bell, and it answers a different question. A
 * notification is immutable and can go stale; this says what is true *now*: if the reason is on
 * screen here, the registration is still waiting on it.
 *
 * Rendered wherever the vendor lands, not just on the status view, because a rejection sends them back
 * to **Draft** — which is the wizard. Scoping these to the status view would hide them at exactly the
 * moment they matter most. Renders nothing when there's nothing to act on: an empty panel saying "no
 * notices" is noise on a screen whose job is to get the vendor to their next action.
 */
function RegistrationNotices({ vendor }: { vendor: VendorDTO }) {
  const { locale } = useLocale();
  const t = useT();
  const [decision, setDecision] = useState<VendorDecisionDTO | null>(null);
  const [docs, setDocs] = useState<RequiredDocumentDTO[]>([]);

  useEffect(() => {
    let alive = true;
    vendorApi
      .latestDecision(locale, vendor.id)
      .then((d) => alive && setDecision(d))
      .catch(() => alive && setDecision(null));
    vendorApi
      .requiredDocuments(locale, vendor.id)
      .then((d) => alive && setDocs(d))
      .catch(() => alive && setDocs([]));
    return () => {
      alive = false;
    };
  }, [locale, vendor.id]);

  const rejectedDocs = docs.filter((d) => d.verifyStatus === "rejected");
  // A rejection is only live while the vendor is back in Draft holding it. Once they resubmit, the
  // record has moved on and the old reason would be describing a state that no longer exists.
  const rejected = decision?.outcome === "rejected" && vendor.status === "draft";

  if (!rejected && rejectedDocs.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {rejected && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive">{t("portal.status.rejectedTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{t("portal.status.rejectedBody")}</p>
            {decision?.reason && (
              <div className="rounded-xl border border-destructive/30 bg-card p-4">
                <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  {t("portal.status.reasonLabel")}
                </div>
                <p className="mt-1 text-sm text-foreground">{decision.reason}</p>
                {decision.decidedByName && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("portal.status.decidedBy", { name: decision.decidedByName })}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {rejectedDocs.length > 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive">{t("portal.status.docRejected")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {rejectedDocs.map((d) => (
              <div
                key={d.documentMasterId}
                className="rounded-xl border border-destructive/30 bg-card p-4"
              >
                <div className="font-semibold text-foreground">
                  {resolveLabel({ id: d.nameId, en: d.nameEn }, locale)}
                </div>
                {d.rejectReason && (
                  <p className="mt-1 text-sm text-muted-foreground">{d.rejectReason}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** No Draft yet — pick origin + company name, create the Draft, drop into the wizard. */
function StartPanel({ onCreated }: { onCreated: (v: VendorDTO) => void }) {
  const { locale } = useLocale();
  const t = useT();
  const [origin, setOrigin] = useState<"local" | "foreign">("local");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      onCreated(await vendorApi.create(locale, { origin, source: "self", name: name.trim() }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>{t("portal.reg.startTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p className="text-sm text-muted-foreground">{t("portal.reg.startBody")}</p>
        <div className="flex flex-col gap-3">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {t("portal.reg.originQuestion")}
          </span>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["local", "foreign"] as const).map((o) => (
              <button
                type="button"
                key={o}
                onClick={() => setOrigin(o)}
                className={`rounded-xl border-2 p-4 text-left transition-colors ${
                  origin === o
                    ? "border-primary bg-primary/5"
                    : "border-input hover:border-primary/40"
                }`}
              >
                <div className="font-bold text-foreground">
                  {t(`enum.origin.${o}` as MessageKey)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {o === "local"
                    ? t("portal.reg.originLocalHint")
                    : t("portal.reg.originForeignHint")}
                </div>
              </button>
            ))}
          </div>
        </div>
        <Field label={t("portal.reg.companyName")} required>
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <div>
          <Button onClick={create} disabled={busy || !name.trim()}>
            {t("portal.reg.create")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** One read-only label/value row in the status summary. */
function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-2 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-semibold text-foreground">{value || "—"}</span>
    </div>
  );
}

/**
 * Submitted (or beyond) — the read-only status view (M3.7): "where's my registration?". Shows the
 * lifecycle status plus a read-only summary of what was submitted (profile, banks, documents) so the
 * vendor can see their registration without being able to edit it (the Draft is no longer editable).
 */
/**
 * How one required document reads on the status view — the verifier's outcome where there is one,
 * else whether it's been captured.
 *
 * Split out because the two facts rank: `captured` says the vendor did their part, `verifyStatus` says
 * whether it was accepted. A rejected document is captured, so showing "uploaded" for it would tell the
 * vendor there's nothing to do on the one row that needs them most.
 */
const docTone = (d: RequiredDocumentDTO): StatusPillProps["tone"] =>
  // `verifyStatusTone` is the shared map, so a verified document reads the same colour here as it does
  // in the console's verification queue — the vendor and the verifier see one status, not two.
  d.verifyStatus ? verifyStatusTone[d.verifyStatus] : d.captured ? "success" : "pending";

const docLabelKey = (d: RequiredDocumentDTO): MessageKey =>
  d.verifyStatus === "verified"
    ? "enum.verifyStatus.verified"
    : d.verifyStatus === "rejected"
      ? "enum.verifyStatus.rejected"
      : d.captured
        ? "portal.doc.uploaded"
        : "portal.doc.mandatory";

function StatusView({ vendor }: { vendor: VendorDTO }) {
  const { locale } = useLocale();
  const t = useT();
  const lists = useLists();
  const pending = vendor.status !== "draft";
  const [banks, setBanks] = useState<BankDTO[]>([]);
  const [docs, setDocs] = useState<RequiredDocumentDTO[]>([]);

  useEffect(() => {
    let alive = true;
    banksApi
      .list(locale, vendor.id)
      .then((b) => alive && setBanks(b))
      .catch(() => alive && setBanks([]));
    vendorApi
      .requiredDocuments(locale, vendor.id)
      .then((d) => alive && setDocs(d))
      .catch(() => alive && setDocs([]));
    return () => {
      alive = false;
    };
  }, [locale, vendor.id]);

  const categoryLabel = (() => {
    const row = vendor.categoryId
      ? lists?.categories.find((r) => r.id === vendor.categoryId)
      : undefined;
    return row ? resolveLabel({ id: row.nameId, en: row.nameEn }, locale) : "";
  })();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      {/* Anything the vendor must act on comes first — above the summary they came here to read. */}
      <RegistrationNotices vendor={vendor} />

      <Card>
        <CardHeader>
          <CardTitle>{t("portal.status.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-foreground">{vendor.name}</span>
            <StatusPill tone={pending ? "pending" : "neutral"}>
              {pending ? t("portal.status.pending") : t("portal.status.draft")}
            </StatusPill>
          </div>
          <p className="text-sm text-muted-foreground">
            {pending ? t("portal.status.pendingBody") : t("portal.status.draftBody")}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("portal.status.summaryTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col">
          <StatusRow
            label={t("portal.reg.originQuestion")}
            value={t(`enum.origin.${vendor.origin}` as MessageKey)}
          />
          <StatusRow label={t("portal.field.taxId")} value={vendor.taxId ?? ""} />
          <StatusRow label={t("portal.field.category")} value={categoryLabel} />
          <StatusRow label={t("portal.field.email")} value={vendor.email ?? ""} />
          <StatusRow label={t("portal.field.picName")} value={vendor.picName ?? ""} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("portal.status.banksTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {banks.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("portal.bank.none")}</p>
          )}
          {banks.map((b) => (
            <div
              key={b.id}
              className="flex items-center justify-between rounded-xl border border-input p-4"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">{b.bankName}</span>
                  {b.isPrimary && (
                    <StatusPill tone="info">{t("portal.bank.primaryBadge")}</StatusPill>
                  )}
                </div>
                <div className="text-sm text-muted-foreground">
                  {b.accountNo} · {b.holderName}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("portal.status.docsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {docs.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("portal.doc.none")}</p>
          )}
          {docs.map((d) => (
            <div
              key={d.documentMasterId}
              className="flex items-center justify-between gap-4 rounded-xl border border-input p-4"
            >
              <span className="font-semibold text-foreground">
                {resolveLabel({ id: d.nameId, en: d.nameEn }, locale)}
              </span>
              {/* The verifier's outcome outranks "uploaded": a rejected document is still captured,
                  so `captured` alone would tell a vendor their work is done when it isn't. */}
              <StatusPill tone={docTone(d)}>{t(docLabelKey(d))}</StatusPill>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/* ── The wizard shell + stepper ───────────────────────────────────────────────────────────────── */

const STEPS: { key: string; titleKey: MessageKey; subKey: MessageKey }[] = [
  { key: "company", titleKey: "portal.step.company", subKey: "portal.step.companySub" },
  { key: "bank", titleKey: "portal.step.bank", subKey: "portal.step.bankSub" },
  { key: "documents", titleKey: "portal.step.documents", subKey: "portal.step.documentsSub" },
  { key: "review", titleKey: "portal.step.review", subKey: "portal.step.reviewSub" },
];

function Wizard({
  vendor,
  onChange,
  onSubmitted,
}: {
  vendor: VendorDTO;
  onChange: (v: VendorDTO) => void;
  onSubmitted: () => void;
}) {
  const t = useT();
  const [step, setStep] = useState(0);
  const total = STEPS.length;

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
      <aside className="hidden lg:block">
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t("portal.reg.stepsTitle")}
        </h3>
        <ol className="flex flex-col gap-1">
          {STEPS.map((s, i) => (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => setStep(i)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                  i === step ? "bg-primary/10" : "hover:bg-secondary"
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    i === step
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {i + 1}
                </span>
                <span>
                  <span className="block text-sm font-semibold text-foreground">
                    {t(s.titleKey)}
                  </span>
                  <span className="block text-xs text-muted-foreground">{t(s.subKey)}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <div className="flex flex-col gap-4">
        {/* A rejected registration comes back to Draft — i.e. to this wizard. Without the notice here
            the vendor would be told to fix something with no way to see what, unless they still had
            the email. */}
        <RegistrationNotices vendor={vendor} />

        <div className="text-sm font-semibold text-muted-foreground">
          {t("portal.reg.stepOf", { n: step + 1, total })} ·{" "}
          {t(STEPS[step]?.titleKey ?? "portal.reg.title")}
        </div>

        {step === 0 && <CompanySection vendor={vendor} onSaved={onChange} />}
        {step === 1 && <BanksSection vendor={vendor} />}
        {step === 2 && <DocumentsSection vendor={vendor} />}
        {step === 3 && <ReviewSection vendor={vendor} onSubmitted={onSubmitted} />}

        <div className="flex justify-between">
          <Button variant="secondary" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
            {t("portal.common.back")}
          </Button>
          {step < total - 1 && (
            <Button onClick={() => setStep((s) => s + 1)}>{t("portal.common.continue")}</Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Section 1: Company profile ───────────────────────────────────────────────────────────────── */

type Form = Record<string, string>;

const TEXT = (v: string | number | null): string =>
  v === null || v === undefined ? "" : String(v);

function CompanySection({
  vendor,
  onSaved,
}: { vendor: VendorDTO; onSaved: (v: VendorDTO) => void }) {
  const { locale } = useLocale();
  const t = useT();
  const { toast } = useToast();
  const lists = useLists();
  const required = useMemo(
    () => new Set<string>(VENDOR_SUBMIT_REQUIRED[vendor.origin]),
    [vendor.origin],
  );
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<Form>(() => ({
    name: vendor.name,
    businessEntityId: TEXT(vendor.businessEntityId),
    categoryId: TEXT(vendor.categoryId),
    taxId: TEXT(vendor.taxId),
    taxStatus: TEXT(vendor.taxStatus),
    npwpType: TEXT(vendor.npwpType),
    companyScale: TEXT(vendor.companyScale),
    procurementNote: TEXT(vendor.procurementNote),
    address: TEXT(vendor.address),
    city: TEXT(vendor.city),
    postal: TEXT(vendor.postal),
    countryId: TEXT(vendor.countryId),
    phone: TEXT(vendor.phone),
    fax: TEXT(vendor.fax),
    yearFounded: TEXT(vendor.yearFounded),
    website: TEXT(vendor.website),
    email: TEXT(vendor.email),
    commissioner: TEXT(vendor.commissioner),
    director: TEXT(vendor.director),
    picName: TEXT(vendor.picName),
    picRole: TEXT(vendor.picRole),
    picPhone: TEXT(vendor.picPhone),
    picEmail: TEXT(vendor.picEmail),
    soechiReference: TEXT(vendor.soechiReference),
    paymentTerm: TEXT(vendor.paymentTerm),
  }));

  const set = (k: string) => (value: string) => setForm((f) => ({ ...f, [k]: value }));

  const save = async () => {
    setSaving(true);
    const payload: VendorDraftPayload = {
      origin: vendor.origin,
      source: "self",
      name: form.name || vendor.name,
    };
    for (const [k, v] of Object.entries(form)) {
      if (k === "name") continue;
      const trimmed = v.trim();
      if (!trimmed) continue;
      payload[k] = k === "yearFounded" ? Number(trimmed) : trimmed;
    }
    try {
      const updated = await vendorApi.update(locale, vendor.id, payload);
      onSaved(updated);
      toast({ title: t("portal.reg.draftSaved"), tone: "success" });
    } catch (e) {
      toast({ title: e instanceof PortalApiError ? e.message : String(e), tone: "danger" });
    } finally {
      setSaving(false);
    }
  };

  const textField = (
    key: string,
    labelKey: MessageKey,
    opts: { helper?: MessageKey; type?: string } = {},
  ) => (
    <Field
      label={t(labelKey)}
      required={required.has(key)}
      helper={opts.helper ? t(opts.helper) : undefined}
    >
      {(p) => (
        <Input
          {...p}
          type={opts.type ?? "text"}
          value={form[key] ?? ""}
          onChange={(e) => set(key)(e.target.value)}
        />
      )}
    </Field>
  );

  const enumField = (
    key: string,
    labelKey: MessageKey,
    values: readonly string[],
    prefix: string,
  ) => (
    <Field label={t(labelKey)} required={required.has(key)}>
      {(p) => (
        <select
          {...p}
          className={SELECT_CLASS}
          value={form[key] ?? ""}
          onChange={(e) => set(key)(e.target.value)}
        >
          <option value="">{t("portal.common.select")}</option>
          {values.map((v) => (
            <option key={v} value={v}>
              {t(`${prefix}.${v}` as MessageKey)}
            </option>
          ))}
        </select>
      )}
    </Field>
  );

  const listField = (key: string, labelKey: MessageKey, rows: BilingualRow[]) => (
    <Field label={t(labelKey)} required={required.has(key)}>
      {(p) => (
        <select
          {...p}
          className={SELECT_CLASS}
          value={form[key] ?? ""}
          onChange={(e) => set(key)(e.target.value)}
        >
          <option value="">{t("portal.common.select")}</option>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {resolveLabel({ id: r.nameId, en: r.nameEn }, locale)}
            </option>
          ))}
        </select>
      )}
    </Field>
  );

  const countryField = (key: string, labelKey: MessageKey) => (
    <Field label={t(labelKey)} required={required.has(key)}>
      {(p) => (
        <select
          {...p}
          className={SELECT_CLASS}
          value={form[key] ?? ""}
          onChange={(e) => set(key)(e.target.value)}
        >
          <option value="">{t("portal.common.select")}</option>
          {(lists?.countries ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  );

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("portal.section.identity")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {textField("name", "portal.field.name")}
          {listField("businessEntityId", "portal.field.businessEntity", lists?.entities ?? [])}
          {listField("categoryId", "portal.field.category", lists?.categories ?? [])}
          {textField("taxId", "portal.field.taxId")}
          {enumField("taxStatus", "portal.field.taxStatus", TAX_STATUSES, "enum.taxStatus")}
          {enumField("npwpType", "portal.field.npwpType", NPWP_TYPES, "enum.npwpType")}
          {enumField(
            "companyScale",
            "portal.field.companyScale",
            COMPANY_SCALES,
            "enum.companyScale",
          )}
          {textField("procurementNote", "portal.field.procurementNote")}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("portal.section.address")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {textField("address", "portal.field.address")}
          {textField("city", "portal.field.city")}
          {textField("postal", "portal.field.postal")}
          {countryField("countryId", "portal.field.country")}
          {textField("phone", "portal.field.phone")}
          {textField("fax", "portal.field.fax")}
          {textField("yearFounded", "portal.field.yearFounded", { type: "number" })}
          {textField("website", "portal.field.website")}
          {textField("email", "portal.field.email", { type: "email" })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("portal.section.people")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {textField("commissioner", "portal.field.commissioner")}
          {textField("director", "portal.field.director")}
          {textField("picName", "portal.field.picName")}
          {textField("picRole", "portal.field.picRole")}
          {textField("picPhone", "portal.field.picPhone", { helper: "portal.field.picPhoneHint" })}
          {textField("picEmail", "portal.field.picEmail", { type: "email" })}
          {textField("soechiReference", "portal.field.soechiReference")}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("portal.section.payment")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {enumField("paymentTerm", "portal.field.paymentTerm", PAYMENT_TERMS, "enum.paymentTerm")}
        </CardContent>
      </Card>

      <div>
        <Button onClick={save} disabled={saving}>
          {t("portal.common.saveDraft")}
        </Button>
      </div>
    </div>
  );
}

/* ── Section 2: Banks ─────────────────────────────────────────────────────────────────────────── */

function BanksSection({ vendor }: { vendor: VendorDTO }) {
  const { locale } = useLocale();
  const t = useT();
  const { toast } = useToast();
  const lists = useLists();
  const [banks, setBanks] = useState<BankDTO[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    banksApi
      .list(locale, vendor.id)
      .then(setBanks)
      .catch(() => setBanks([]));
  }, [locale, vendor.id]);
  useEffect(() => load(), [load]);

  const remove = async (bankId: string) => {
    try {
      await banksApi.remove(locale, vendor.id, bankId);
      load();
    } catch (e) {
      toast({ title: e instanceof PortalApiError ? e.message : String(e), tone: "danger" });
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t("portal.bank.title")}</CardTitle>
        <Button size="sm" onClick={() => setOpen(true)}>
          {t("portal.bank.add")}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {banks.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("portal.bank.none")}</p>
        )}
        {banks.map((b) => (
          <div
            key={b.id}
            className="flex items-center justify-between rounded-xl border border-input p-4"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">{b.bankName}</span>
                {b.isPrimary && (
                  <StatusPill tone="info">{t("portal.bank.primaryBadge")}</StatusPill>
                )}
              </div>
              <div className="text-sm text-muted-foreground">
                {b.accountNo} · {b.holderName}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => b.id && remove(b.id)}>
              {t("portal.common.remove")}
            </Button>
          </div>
        ))}
      </CardContent>
      {open && (
        <BankDialog
          vendor={vendor}
          currencies={lists?.currencies ?? []}
          countries={lists?.countries ?? []}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            load();
          }}
        />
      )}
    </Card>
  );
}

function BankDialog({
  vendor,
  currencies,
  countries,
  onClose,
  onSaved,
}: {
  vendor: VendorDTO;
  currencies: CurrencyRow[];
  countries: CountryRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { locale } = useLocale();
  const t = useT();
  const { toast } = useToast();
  const [form, setForm] = useState<BankDTO>({
    bankName: "",
    accountNo: "",
    holderName: "",
    currencyIds: [],
    holderSameAsCompany: true,
    isPrimary: true,
  });
  const [ktpFile, setKtpFile] = useState<File | null>(null);
  const [suratFile, setSuratFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof BankDTO>(k: K, v: BankDTO[K]) => setForm((f) => ({ ...f, [k]: v }));

  const toggleCurrency = (id: string) =>
    setForm((f) => ({
      ...f,
      currencyIds: f.currencyIds.includes(id)
        ? f.currencyIds.filter((c) => c !== id)
        : [...f.currencyIds, id],
    }));

  const save = async () => {
    setSaving(true);
    try {
      const input: BankDTO = { ...form };
      if (!input.holderSameAsCompany) {
        if (ktpFile) input.ktpFileId = await banksApi.uploadAttachment(locale, vendor.id, ktpFile);
        if (suratFile)
          input.suratPernyataanFileId = await banksApi.uploadAttachment(
            locale,
            vendor.id,
            suratFile,
          );
      }
      await banksApi.create(locale, vendor.id, input);
      onSaved();
    } catch (e) {
      toast({ title: e instanceof PortalApiError ? e.message : String(e), tone: "danger" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("portal.bank.add")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("portal.bank.bankName")} required>
            {(p) => (
              <Input
                {...p}
                value={form.bankName}
                onChange={(e) => set("bankName", e.target.value)}
              />
            )}
          </Field>
          <Field label={t("portal.bank.accountNo")} required>
            {(p) => (
              <Input
                {...p}
                value={form.accountNo}
                onChange={(e) => set("accountNo", e.target.value)}
              />
            )}
          </Field>
          <Field label={t("portal.bank.holderName")} required>
            {(p) => (
              <Input
                {...p}
                value={form.holderName}
                onChange={(e) => set("holderName", e.target.value)}
              />
            )}
          </Field>
          <Field label={t("portal.bank.branch")}>
            {(p) => (
              <Input
                {...p}
                value={form.branch ?? ""}
                onChange={(e) => set("branch", e.target.value)}
              />
            )}
          </Field>
          <Field label={t("portal.bank.swift")}>
            {(p) => (
              <Input
                {...p}
                value={form.swift ?? ""}
                onChange={(e) => set("swift", e.target.value)}
              />
            )}
          </Field>
          <Field label={t("portal.bank.bankCountry")}>
            {(p) => (
              <select
                {...p}
                className={SELECT_CLASS}
                value={form.bankCountryId ?? ""}
                onChange={(e) => set("bankCountryId", e.target.value)}
              >
                <option value="">{t("portal.common.select")}</option>
                {countries.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        <div className="mt-2">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {t("portal.bank.currency")}
          </span>
          <div className="mt-2 flex flex-wrap gap-2">
            {currencies.map((c) => (
              <label
                key={c.id}
                className={`cursor-pointer rounded-full border px-3 py-1 text-sm font-semibold ${
                  form.currencyIds.includes(c.id)
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input text-muted-foreground"
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={form.currencyIds.includes(c.id)}
                  onChange={() => toggleCurrency(c.id)}
                />
                {c.code}
              </label>
            ))}
          </div>
        </div>

        <div className="mt-2 flex flex-col gap-2">
          <span className="text-sm font-semibold text-foreground">
            {t("portal.bank.holderSameQuestion")}
          </span>
          <div className="flex gap-3">
            {[
              { same: true, labelKey: "portal.bank.holderSameYes" as MessageKey },
              { same: false, labelKey: "portal.bank.holderSameNo" as MessageKey },
            ].map((opt) => (
              <button
                type="button"
                key={String(opt.same)}
                onClick={() => set("holderSameAsCompany", opt.same)}
                className={`flex-1 rounded-xl border-2 p-3 text-sm font-semibold transition-colors ${
                  form.holderSameAsCompany === opt.same
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-input text-muted-foreground"
                }`}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {!form.holderSameAsCompany && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("portal.bank.ktp")} required>
              {(p) => (
                <Input
                  {...p}
                  type="file"
                  onChange={(e) => setKtpFile(e.target.files?.[0] ?? null)}
                />
              )}
            </Field>
            <Field label={t("portal.bank.surat")} required>
              {(p) => (
                <Input
                  {...p}
                  type="file"
                  onChange={(e) => setSuratFile(e.target.files?.[0] ?? null)}
                />
              )}
            </Field>
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t("portal.common.cancel")}
          </Button>
          <Button
            onClick={save}
            disabled={
              saving ||
              !form.bankName ||
              !form.accountNo ||
              !form.holderName ||
              form.currencyIds.length === 0
            }
          >
            {t("portal.common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Section 3: Documents ─────────────────────────────────────────────────────────────────────── */

function DocumentsSection({ vendor }: { vendor: VendorDTO }) {
  const { locale } = useLocale();
  const t = useT();
  const { toast } = useToast();
  const [docs, setDocs] = useState<RequiredDocumentDTO[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    vendorApi
      .requiredDocuments(locale, vendor.id)
      .then(setDocs)
      .catch(() => setDocs([]));
  }, [locale, vendor.id]);
  useEffect(() => load(), [load]);

  const upload = async (documentMasterId: string, file: File) => {
    setBusy(documentMasterId);
    try {
      await docsApi.uploadVersion(locale, vendor.id, { file, documentMasterId });
      load();
    } catch (e) {
      toast({ title: e instanceof PortalApiError ? e.message : String(e), tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("portal.doc.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {docs.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("portal.doc.none")}</p>
        )}
        {docs.map((d) => (
          <div
            key={d.documentMasterId}
            className="flex items-center justify-between gap-4 rounded-xl border border-input p-4"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">
                  {resolveLabel({ id: d.nameId, en: d.nameEn }, locale)}
                </span>
                <StatusPill tone={d.captured ? "success" : "pending"}>
                  {d.captured ? t("portal.doc.uploaded") : t("portal.doc.mandatory")}
                </StatusPill>
              </div>
              <div className="text-xs text-muted-foreground">
                {d.no} · {t("portal.doc.constraint")}
              </div>
            </div>
            <label className="shrink-0">
              <span className="cursor-pointer rounded-xl border border-input bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-secondary">
                {busy === d.documentMasterId ? t("portal.common.loading") : t("portal.doc.browse")}
              </span>
              <input
                type="file"
                className="sr-only"
                disabled={busy !== null}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) upload(d.documentMasterId, file);
                }}
              />
            </label>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ── Section 4: Review + submit ───────────────────────────────────────────────────────────────── */

function ReviewSection({ vendor, onSubmitted }: { vendor: VendorDTO; onSubmitted: () => void }) {
  const { locale } = useLocale();
  const t = useT();
  const { toast } = useToast();
  const [readiness, setReadiness] = useState<SubmitReadiness | null>(null);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const evaluate = useCallback(async () => {
    const [banks, docs] = await Promise.all([
      banksApi.list(locale, vendor.id).catch(() => [] as BankDTO[]),
      vendorApi.requiredDocuments(locale, vendor.id).catch(() => [] as RequiredDocumentDTO[]),
    ]);
    // The gate only reads field presence + origin/countryId — the portal DTO's looser `string` enums
    // and `null` (vs `undefined`) optionals are runtime-compatible, so a cast is safe here.
    const candidate: VendorSubmissionCandidate = {
      profile: vendor as unknown as VendorSubmissionCandidate["profile"],
      banks: banks as unknown as VendorSubmissionCandidate["banks"],
      requiredDocMasterIds: docs.map((d) => d.documentMasterId),
      capturedDocuments: docs.map((d) => ({
        documentMasterId: d.documentMasterId,
        hasCurrentVersion: d.captured,
      })),
    };
    setReadiness(checkVendorSubmittable(candidate));
  }, [locale, vendor]);

  useEffect(() => {
    evaluate();
  }, [evaluate]);

  const submit = async () => {
    setSubmitting(true);
    setConflictMsg(null);
    try {
      await vendorApi.submit(locale, vendor.id);
      toast({ title: t("portal.status.pending"), tone: "success" });
      onSubmitted();
    } catch (e) {
      if (e instanceof PortalApiError && e.messageKey === "error.vendor.taxIdDuplicate") {
        setConflictMsg(e.message);
      } else {
        toast({ title: e instanceof PortalApiError ? e.message : String(e), tone: "danger" });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const summary = (labelKey: MessageKey, value: string) => (
    <div className="flex justify-between border-b border-border py-2 text-sm">
      <span className="text-muted-foreground">{t(labelKey)}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("portal.review.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div>
          {summary("portal.review.sectionProfile", vendor.name)}
          {summary("portal.field.taxId", vendor.taxId ?? "—")}
          {summary("portal.reg.originQuestion", t(`enum.origin.${vendor.origin}` as MessageKey))}
        </div>

        {conflictMsg && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm font-semibold text-destructive">
            {conflictMsg}
          </div>
        )}

        {readiness && !readiness.ok && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-4">
            <p className="mb-2 text-sm font-bold text-warning-foreground">
              {t("portal.review.blockersTitle")}
            </p>
            <ul className="flex flex-col gap-1">
              {readiness.issues.map((issue, i) => (
                <li
                  key={`${issue.section}-${issue.path ?? i}`}
                  className="text-sm text-warning-foreground"
                >
                  • {t(issue.messageKey, issue.params)}
                  {issue.path ? ` (${issue.path})` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-xs text-muted-foreground">{t("portal.review.note")}</p>

        <div>
          <Button onClick={submit} disabled={submitting || !readiness?.ok}>
            {t("portal.review.submit")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
