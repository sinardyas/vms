/**
 * Console — office vendor registration (M3.6, #47, ADR-0004/0009/0013).
 *
 * Staff register a vendor **on-behalf**: pick origin + name → a `source=office` Draft, then the same
 * multi-section capture the portal uses (Company profile + Banks M3.2 + Documents M3.3), gated by the
 * *same* `@vms/domain` submit check (M3.4) — so the office bar can't drift from the portal's. Submit
 * routes the vendor to **Pending-HOD** (ADR-0009 `office_vendor_registration` → HOD), after which it's
 * out of staff hands until HOD approval (M4/M5). Required-field stars and the Submit gate both read the
 * single domain source, so what the form marks required is exactly what submission enforces.
 *
 * Unlike the portal there is no account/resume: staff register many vendors, so the screen is a fresh
 * start → wizard → confirmation each time (an abandoned Draft is an orphan, same as the portal's).
 */

import {
  ArrowLeft,
  Bank,
  ClockCounterClockwise,
  FileText,
  IdentificationCard,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Warning,
} from "@phosphor-icons/react";
import {
  COMPANY_SCALES,
  type MessageKey,
  NPWP_TYPES,
  PAYMENT_TERMS,
  type SubmitReadiness,
  TAX_STATUSES,
  VENDOR_SUBMIT_REQUIRED,
  type VendorStatus,
  type VendorSubmissionCandidate,
  checkVendorSubmittable,
  resolveLabel,
} from "@vms/domain";
import {
  Badge,
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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useCapabilities,
  useLocale,
  useT,
  useToast,
  vendorStatusTone,
  verifyStatusTone,
} from "@vms/ui";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { type ChangeRequestDTO, changesApi } from "../lib/approvals";
import type { RaiseChangeInput } from "../lib/approvals";
import {
  type AuditRowDTO,
  type BankDTO,
  type BilingualRow,
  type CountryRow,
  type CurrencyRow,
  type DocumentSlotDTO,
  type RequiredDocumentDTO,
  VendorApiError,
  type VendorDTO,
  type VendorDraftPayload,
  type VendorSummaryDTO,
  auditApi,
  banksApi,
  docsApi,
  listsApi,
  vendorApi,
} from "../lib/vendors";

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

/** The purple "requires HOD approval" banner the prototype shows on every office-registration surface. */
function HodNotice() {
  const t = useT();
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-foreground">
      {t("console.vendorReg.hodNotice")}
    </div>
  );
}

/* ── Top-level: vendor list → (profile view | office registration) ────────────────────────────── */

/**
 * The console **Vendors** section (M3.7). Its home is the browse **list**; from there a row opens the
 * read-only **profile** (details/docs/bank/activity tabs), and the "Register vendor" action drops into
 * the M3.6 office-registration wizard. Both the list and the profile gate on `vendors:view` (the nav
 * item is already hidden without it); "Register vendor" additionally needs `vendors:add`.
 */
export function Vendors() {
  const [mode, setMode] = useState<
    { v: "list" } | { v: "register" } | { v: "profile"; id: string }
  >({ v: "list" });

  if (mode.v === "register") return <OfficeRegistration onClose={() => setMode({ v: "list" })} />;
  if (mode.v === "profile")
    return <VendorProfile vendorId={mode.id} onBack={() => setMode({ v: "list" })} />;
  return (
    <VendorList
      onOpen={(id) => setMode({ v: "profile", id })}
      onRegister={() => setMode({ v: "register" })}
    />
  );
}

/* ── Office registration: start → wizard → done ───────────────────────────────────────────────── */

function OfficeRegistration({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<
    { step: "start" } | { step: "wizard"; vendor: VendorDTO } | { step: "done" }
  >({ step: "start" });

  if (phase.step === "start")
    return (
      <StartPanel onCreated={(vendor) => setPhase({ step: "wizard", vendor })} onCancel={onClose} />
    );
  if (phase.step === "done")
    return <DonePanel onAgain={() => setPhase({ step: "start" })} onClose={onClose} />;
  return (
    <Wizard
      vendor={phase.vendor}
      onVendorChange={(vendor) => setPhase({ step: "wizard", vendor })}
      onSubmitted={() => setPhase({ step: "done" })}
      onCancel={() => setPhase({ step: "start" })}
    />
  );
}

/** Landing — intro + HOD notice, pick origin + company name, create the office Draft, drop into wizard. */
function StartPanel({
  onCreated,
  onCancel,
}: { onCreated: (v: VendorDTO) => void; onCancel: () => void }) {
  const { locale } = useLocale();
  const t = useT();
  const { toast } = useToast();
  const [origin, setOrigin] = useState<"local" | "foreign">("local");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      onCreated(await vendorApi.create(locale, { origin, name: name.trim() }));
    } catch (e) {
      toast({ title: e instanceof VendorApiError ? e.message : String(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <Button variant="ghost" size="sm" className="self-start" onClick={onCancel}>
        <ArrowLeft weight="bold" />
        {t("console.vendorList.backToList")}
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>{t("console.vendorReg.startTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <p className="text-sm text-muted-foreground">{t("console.vendorReg.startBody")}</p>
          <HodNotice />
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
              {t("console.vendorReg.create")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Submitted → Pending-HOD confirmation; the office user can register another or return to the list. */
function DonePanel({ onAgain, onClose }: { onAgain: () => void; onClose: () => void }) {
  const t = useT();
  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>{t("console.vendorReg.successTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <StatusPill tone="info">{t("console.vendorReg.successTitle")}</StatusPill>
        </div>
        <p className="text-sm text-muted-foreground">{t("console.vendorReg.successBody")}</p>
        <div className="flex gap-2">
          <Button onClick={onAgain}>{t("console.vendorReg.registerAnother")}</Button>
          <Button variant="secondary" onClick={onClose}>
            {t("console.vendorList.backToList")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Vendor browse list ───────────────────────────────────────────────────────────────────────── */

/** `enum.vendorStatus.*` label key for a status code (unknown codes fall back to the raw code). */
const statusKey = (status: string): MessageKey => `enum.vendorStatus.${status}` as MessageKey;
/** Lifecycle tone for a status code — `neutral` for anything outside the known set. */
const statusTone = (status: string) => vendorStatusTone[status as VendorStatus] ?? "neutral";
/** Two-letter monogram for a vendor's avatar tile. */
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

function VendorList({
  onOpen,
  onRegister,
}: { onOpen: (id: string) => void; onRegister: () => void }) {
  const { locale } = useLocale();
  const t = useT();
  const { can } = useCapabilities();
  const lists = useLists();
  const [vendors, setVendors] = useState<VendorSummaryDTO[] | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    setVendors(null);
    setError(false);
    vendorApi
      .list(locale)
      .then((v) => {
        if (alive) setVendors(v);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [locale]);

  const categoryLabel = useCallback(
    (id: string | null): string => {
      const row = id ? lists?.categories.find((r) => r.id === id) : undefined;
      return row ? resolveLabel({ id: row.nameId, en: row.nameEn }, locale) : "—";
    },
    [lists, locale],
  );
  const countryLabel = useCallback(
    (id: string | null): string => lists?.countries.find((c) => c.id === id)?.name ?? "—",
    [lists],
  );

  const filtered = useMemo(() => {
    const rows = vendors ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((v) =>
      [
        v.name,
        v.taxId ?? "",
        categoryLabel(v.categoryId),
        countryLabel(v.countryId),
        t(statusKey(v.status)),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [vendors, query, categoryLabel, countryLabel, t]);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{t("console.vendorList.title")}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t("console.vendorList.subtitle")}</p>
        </div>
        {can("vendors", "add") && (
          <Button size="sm" onClick={onRegister}>
            <Plus weight="bold" />
            {t("console.vendorReg.registerCta")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <MagnifyingGlass
            weight="bold"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("console.vendorList.searchPlaceholder")}
            className="pl-9"
          />
        </div>

        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("console.vendorList.colVendor")}</TableHead>
                <TableHead>{t("console.vendorList.colCountry")}</TableHead>
                <TableHead>{t("console.vendorList.colCategory")}</TableHead>
                <TableHead>{t("console.vendorList.colTaxId")}</TableHead>
                <TableHead>{t("console.vendorList.colStatus")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {error ? (
                <TableEmpty colSpan={5}>{t("console.vendorList.loadError")}</TableEmpty>
              ) : vendors === null ? (
                <TableEmpty colSpan={5}>{t("portal.common.loading")}</TableEmpty>
              ) : filtered.length === 0 ? (
                <TableEmpty colSpan={5}>
                  {query.trim() ? t("console.vendorList.noResults") : t("console.vendorList.empty")}
                </TableEmpty>
              ) : (
                filtered.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => onOpen(v.id)}
                        className="flex items-center gap-3 text-left"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                          {initials(v.name)}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-foreground hover:text-primary">
                            {v.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {t(
                              v.source === "office"
                                ? "console.vendorList.sourceOffice"
                                : "console.vendorList.sourceSelf",
                            )}
                          </div>
                        </div>
                      </button>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {countryLabel(v.countryId)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {categoryLabel(v.categoryId)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {v.taxId ?? "—"}
                    </TableCell>
                    <TableCell>
                      <StatusPill tone={statusTone(v.status)}>{t(statusKey(v.status))}</StatusPill>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}

/* ── Vendor profile (read-only) — details / documents / bank / activity ───────────────────────── */

function VendorProfile({ vendorId, onBack }: { vendorId: string; onBack: () => void }) {
  const { locale } = useLocale();
  const t = useT();
  const { can } = useCapabilities();
  const [vendor, setVendor] = useState<VendorDTO | null>(null);
  const [error, setError] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [changeKind, setChangeKind] = useState<ChangeKind | null>(null);
  const canAudit = can("audit", "view");
  const canEdit = can("vendors", "edit");

  const reload = useCallback(() => {
    let alive = true;
    setVendor(null);
    setError(false);
    vendorApi
      .get(locale, vendorId)
      .then((v) => {
        if (alive) setVendor(v);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [locale, vendorId]);

  useEffect(() => reload(), [reload]);

  const back = (
    <Button variant="ghost" size="sm" className="self-start" onClick={onBack}>
      <ArrowLeft weight="bold" />
      {t("console.vendorList.backToList")}
    </Button>
  );

  if (error)
    return (
      <div className="flex flex-col gap-4">
        {back}
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("console.vendorProfile.loadError")}
          </CardContent>
        </Card>
      </div>
    );
  if (!vendor)
    return (
      <div className="flex flex-col gap-4">
        {back}
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("portal.common.loading")}
          </CardContent>
        </Card>
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      {back}
      <Card>
        <CardContent className="flex items-center gap-4 py-5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
            {initials(vendor.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-bold text-foreground">{vendor.name}</span>
              <Badge tone="navy">{t(`enum.origin.${vendor.origin}` as MessageKey)}</Badge>
              <StatusPill tone={statusTone(vendor.status)}>
                {t(statusKey(vendor.status))}
              </StatusPill>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {t(
                vendor.source === "office"
                  ? "console.vendorList.sourceOffice"
                  : "console.vendorList.sourceSelf",
              )}
            </div>
          </div>
          {/* Raise a post-activation change (M4.6b). Hidden once a change is in flight — the one-per-vendor
              lock (ADR-0010) forbids a second, and the pending-change banner is showing instead. */}
          {vendor.status === "active" && canEdit && !vendor.changePending && !changeKind && (
            <Button
              size="sm"
              variant="secondary"
              className="shrink-0"
              onClick={() => setChoosing(true)}
            >
              <PencilSimple weight="bold" />
              {t("console.vendorProfile.requestChange")}
            </Button>
          )}
        </CardContent>
      </Card>

      {changeKind ? (
        <ChangeEditor
          vendor={vendor}
          kind={changeKind}
          onRaised={() => {
            setChangeKind(null);
            reload();
          }}
          onCancel={() => setChangeKind(null)}
        />
      ) : (
        <>
          {vendor.changePending && (
            <PendingChangeBanner vendorId={vendorId} canEdit={canEdit} onCancelled={reload} />
          )}

          <Tabs defaultValue="details">
            <TabsList>
              <TabsTrigger value="details">
                <IdentificationCard weight="bold" />
                {t("console.vendorProfile.tabDetails")}
              </TabsTrigger>
              <TabsTrigger value="documents">
                <FileText weight="bold" />
                {t("console.vendorProfile.tabDocuments")}
              </TabsTrigger>
              <TabsTrigger value="bank">
                <Bank weight="bold" />
                {t("console.vendorProfile.tabBank")}
              </TabsTrigger>
              {canAudit && (
                <TabsTrigger value="activity">
                  <ClockCounterClockwise weight="bold" />
                  {t("console.vendorProfile.tabActivity")}
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="details">
              <DetailsTab vendor={vendor} />
            </TabsContent>
            <TabsContent value="documents">
              <DocumentsTab vendorId={vendorId} />
            </TabsContent>
            <TabsContent value="bank">
              <BankTab vendorId={vendorId} />
            </TabsContent>
            {canAudit && (
              <TabsContent value="activity">
                <ActivityTab vendorId={vendorId} />
              </TabsContent>
            )}
          </Tabs>
        </>
      )}

      {choosing && (
        <ChangeKindChooser
          onClose={() => setChoosing(false)}
          onPick={(k) => {
            setChoosing(false);
            setChangeKind(k);
          }}
        />
      )}
    </div>
  );
}

/**
 * Post-activation change banner (M4.6/M4.5, #61/#60). An Active vendor with a `change_pending` flag has
 * an edit in flight; this reads `GET …/change-requests/current` and surfaces the kind + an "under review"
 * note, and (for `vendors:edit` holders) lets the submitter withdraw it pre-decision — the approver side
 * lives in the Approvals queue. Only mounted when `vendor.changePending` is set, so no extra fetch runs
 * for the common no-change case.
 */
function PendingChangeBanner({
  vendorId,
  canEdit,
  onCancelled,
}: { vendorId: string; canEdit: boolean; onCancelled: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const { toast } = useToast();
  const [change, setChange] = useState<ChangeRequestDTO | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    changesApi
      .current(locale, vendorId)
      .then((c) => alive && setChange(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [locale, vendorId]);

  if (!change) return null;

  const cancel = async () => {
    setBusy(true);
    try {
      await changesApi.cancel(locale, vendorId);
      toast({ title: t("console.vendorProfile.changeCancelled"), tone: "success" });
      onCancelled();
    } catch (e) {
      const msg =
        e instanceof VendorApiError ? e.message : t("console.vendorProfile.changeCancelError");
      toast({ title: msg, tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-warning/40 bg-warning/5">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Warning weight="fill" className="text-warning-foreground" />
            <span className="font-semibold">{t("console.vendorProfile.changePending")}</span>
            <Badge tone="navy">{t(`enum.approvalTrigger.${change.trigger}` as MessageKey)}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("console.vendorProfile.changePendingBody")}
          </p>
        </div>
        {canEdit && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void cancel()}>
            {t("console.vendorProfile.changeCancel")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Post-activation change: raise an edit (M4.6b, #67) ───────────────────────────────────────── */

/** The two change kinds staff can raise on an Active vendor (ADR-0009 routes them apart). */
type ChangeKind = "non_bank" | "bank";

/**
 * Chooser — "What would you like to change?" Picks the kind before the editor opens, because the two
 * route differently (bank → AP Manager, non-bank → AP Supervisor) and drive different capture surfaces.
 */
function ChangeKindChooser({
  onPick,
  onClose,
}: { onPick: (kind: ChangeKind) => void; onClose: () => void }) {
  const t = useT();
  const options: {
    kind: ChangeKind;
    icon: ReactNode;
    titleKey: MessageKey;
    subKey: MessageKey;
  }[] = [
    {
      kind: "non_bank",
      icon: <IdentificationCard weight="bold" className="text-primary" />,
      titleKey: "console.vendorProfile.changeKindProfile",
      subKey: "console.vendorProfile.changeKindProfileSub",
    },
    {
      kind: "bank",
      icon: <Bank weight="bold" className="text-primary" />,
      titleKey: "console.vendorProfile.changeKindBank",
      subKey: "console.vendorProfile.changeKindBankSub",
    },
  ];
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("console.vendorProfile.changeKindTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {options.map((o) => (
            <button
              type="button"
              key={o.kind}
              onClick={() => onPick(o.kind)}
              className="flex items-center gap-3 rounded-xl border-2 border-input p-4 text-left transition-colors hover:border-primary hover:bg-primary/5"
            >
              {o.icon}
              <span>
                <span className="block text-sm font-semibold text-foreground">{t(o.titleKey)}</span>
                <span className="block text-xs text-muted-foreground">{t(o.subKey)}</span>
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The change-raising editor. Frames the reused capture UI for one kind and owns the POST to
 * `/vendors/:id/change-requests`: a **non-bank** change reuses {@link CompanySection} (full profile
 * replacement, pre-filled from the live record); a **bank** change uses {@link BankBlockEditor} (full
 * block replacement). On success the vendor gains its `change_pending` flag → the caller reloads and the
 * pending-change banner takes over, the record staying Active. The API guards (422 completeness /
 * bank-remark, 409 one-pending lock) surface localized via {@link VendorApiError}; on failure the section
 * keeps its state so staff can fix and retry.
 */
function ChangeEditor({
  vendor,
  kind,
  onRaised,
  onCancel,
}: {
  vendor: VendorDTO;
  kind: ChangeKind;
  onRaised: () => void;
  onCancel: () => void;
}) {
  const { locale } = useLocale();
  const t = useT();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  // One raise path for both kinds: success toasts + hands back (the banner takes over); a failure toasts
  // the localized reason and is swallowed here so the editing surface stays put for a retry.
  const raise = async (change: RaiseChangeInput) => {
    setBusy(true);
    try {
      await changesApi.raise(locale, vendor.id, change);
      toast({ title: t("console.vendorProfile.changeSubmitted"), tone: "success" });
      onRaised();
    } catch (e) {
      toast({ title: e instanceof VendorApiError ? e.message : String(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">
            {t(
              kind === "bank"
                ? "console.vendorProfile.changeBankTitle"
                : "console.vendorProfile.changeProfileTitle",
            )}
          </h2>
          <p className="text-xs text-muted-foreground">{t("console.vendorProfile.changeIntro")}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          <ArrowLeft weight="bold" />
          {t("portal.common.cancel")}
        </Button>
      </div>

      {kind === "non_bank" ? (
        <CompanySection
          vendor={vendor}
          onSaved={() => {}}
          raise={{ onSubmit: (profile) => raise({ kind: "non_bank", profile }) }}
        />
      ) : (
        <BankBlockEditor
          vendor={vendor}
          busy={busy}
          onSubmit={(banks) => raise({ kind: "bank", banks })}
        />
      )}
    </div>
  );
}

/** Map a composed bank account to the change diff's account shape — nulls/blanks dropped (optionals absent). */
const bankToInput = (b: BankDTO, isPrimary: boolean): Record<string, unknown> => {
  const out: Record<string, unknown> = {
    bankName: b.bankName,
    accountNo: b.accountNo,
    holderName: b.holderName,
    currencyIds: b.currencyIds,
    holderSameAsCompany: b.holderSameAsCompany,
    isPrimary,
  };
  const optional: (keyof BankDTO)[] = [
    "bankId",
    "branch",
    "description",
    "swift",
    "iban",
    "bankCountryId",
    "differsFromCompanyRemark",
    "proofFileId",
    "ktpFileId",
    "suratPernyataanFileId",
  ];
  for (const key of optional) {
    const value = b[key];
    if (value !== null && value !== undefined && value !== "") out[key] = value;
  }
  return out;
};

/**
 * Bank-block editor for a post-activation change. Loads the vendor's current accounts into local state,
 * lets staff add / edit / remove and pick the single primary, then POSTs the whole replacement set as one
 * `{kind:"bank"}` diff — the live record is frozen (M4.4), so nothing is written until the change is
 * approved. Existing accounts carry their attachment file ids; a new account is company-held (fresh
 * holder-proof attachments can't be uploaded post-activation). The block needs ≥1 account and exactly one
 * primary before submit (the shared Zod + API re-check both, surfacing any 422 localized).
 */
function BankBlockEditor({
  vendor,
  busy,
  onSubmit,
}: {
  vendor: VendorDTO;
  busy: boolean;
  onSubmit: (banks: Record<string, unknown>[]) => Promise<void>;
}) {
  const { locale } = useLocale();
  const t = useT();
  const lists = useLists();
  const [banks, setBanks] = useState<BankDTO[] | null>(null);
  const [primaryIdx, setPrimaryIdx] = useState(0);
  // null = dialog closed · "new" = add · number = edit that index.
  const [editing, setEditing] = useState<number | "new" | null>(null);

  useEffect(() => {
    let alive = true;
    banksApi
      .list(locale, vendor.id)
      .then((b) => {
        if (!alive) return;
        setBanks(b);
        const p = b.findIndex((x) => x.isPrimary);
        setPrimaryIdx(p >= 0 ? p : 0);
      })
      .catch(() => alive && setBanks([]));
    return () => {
      alive = false;
    };
  }, [locale, vendor.id]);

  const upsert = (bank: BankDTO) =>
    setBanks((prev) => {
      const list = prev ?? [];
      if (editing === "new") return [...list, bank];
      if (typeof editing === "number") return list.map((b, i) => (i === editing ? bank : b));
      return list;
    });

  const remove = (i: number) => {
    setBanks((prev) => (prev ?? []).filter((_, idx) => idx !== i));
    setPrimaryIdx((p) => (i === p ? 0 : i < p ? p - 1 : p));
  };

  const currencyCodes = (ids: string[]): string =>
    ids.map((id) => lists?.currencies.find((c) => c.id === id)?.code ?? id).join(", ");

  const submit = () => onSubmit((banks ?? []).map((b, i) => bankToInput(b, i === primaryIdx)));

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t("portal.bank.title")}</CardTitle>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus weight="bold" />
          {t("console.vendorProfile.changeBankAdd")}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {banks === null && (
          <p className="text-sm text-muted-foreground">{t("portal.common.loading")}</p>
        )}
        {banks !== null && banks.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("console.vendorProfile.changeBankEmpty")}
          </p>
        )}
        {(banks ?? []).map((b, i) => (
          <div
            key={b.id ?? `new-${i}`}
            className="flex items-center justify-between gap-3 rounded-xl border border-input p-4"
          >
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="change-primary"
                className="mt-1"
                checked={i === primaryIdx}
                onChange={() => setPrimaryIdx(i)}
              />
              <span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">{b.bankName}</span>
                  {i === primaryIdx && (
                    <StatusPill tone="info">{t("portal.bank.primaryBadge")}</StatusPill>
                  )}
                </span>
                <span className="mt-0.5 block text-sm text-muted-foreground">
                  {b.accountNo} · {b.holderName}
                  {b.currencyIds.length > 0 ? ` · ${currencyCodes(b.currencyIds)}` : ""}
                </span>
              </span>
            </label>
            <div className="flex shrink-0 gap-1">
              <Button variant="ghost" size="sm" onClick={() => setEditing(i)}>
                {t("console.vendorProfile.changeBankEdit")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => remove(i)}>
                {t("portal.common.remove")}
              </Button>
            </div>
          </div>
        ))}
        <div className="pt-2">
          <Button onClick={submit} disabled={busy || banks === null || banks.length === 0}>
            {t("console.vendorProfile.changeSubmit")}
          </Button>
        </div>
      </CardContent>
      {editing !== null && (
        <BankDialog
          vendor={vendor}
          currencies={lists?.currencies ?? []}
          countries={lists?.countries ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {}}
          compose={{
            initial: typeof editing === "number" ? banks?.[editing] : undefined,
            onCompose: upsert,
          }}
        />
      )}
    </Card>
  );
}

/** One read-only labelled value in the profile grids. */
function ReadField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-xl border border-input bg-secondary/40 p-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-foreground">
        {value === null || value === undefined || value === "" ? "—" : value}
      </div>
    </div>
  );
}

/** Details tab — the full vendor profile, read-only, with ids resolved to their master labels. */
function DetailsTab({ vendor }: { vendor: VendorDTO }) {
  const { locale } = useLocale();
  const t = useT();
  const lists = useLists();

  const listLabel = (rows: BilingualRow[] | undefined, id: string | null): string => {
    const row = id ? rows?.find((r) => r.id === id) : undefined;
    return row ? resolveLabel({ id: row.nameId, en: row.nameEn }, locale) : "—";
  };
  const enumLabel = (prefix: string, value: string | null): string =>
    value ? t(`${prefix}.${value}` as MessageKey) : "—";
  const countryName = lists?.countries.find((c) => c.id === vendor.countryId)?.name ?? null;

  const section = (titleKey: MessageKey, children: React.ReactNode) => (
    <Card>
      <CardHeader>
        <CardTitle>{t(titleKey)}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col gap-4">
      {section(
        "portal.section.identity",
        <>
          <ReadField label={t("portal.field.name")} value={vendor.name} />
          <ReadField
            label={t("portal.field.businessEntity")}
            value={listLabel(lists?.entities, vendor.businessEntityId)}
          />
          <ReadField
            label={t("portal.field.category")}
            value={listLabel(lists?.categories, vendor.categoryId)}
          />
          <ReadField label={t("portal.field.taxId")} value={vendor.taxId} />
          <ReadField
            label={t("portal.field.taxStatus")}
            value={enumLabel("enum.taxStatus", vendor.taxStatus)}
          />
          <ReadField
            label={t("portal.field.npwpType")}
            value={enumLabel("enum.npwpType", vendor.npwpType)}
          />
          <ReadField
            label={t("portal.field.companyScale")}
            value={enumLabel("enum.companyScale", vendor.companyScale)}
          />
          <ReadField label={t("portal.field.procurementNote")} value={vendor.procurementNote} />
        </>,
      )}
      {section(
        "portal.section.address",
        <>
          <ReadField label={t("portal.field.address")} value={vendor.address} />
          <ReadField label={t("portal.field.city")} value={vendor.city} />
          <ReadField label={t("portal.field.postal")} value={vendor.postal} />
          <ReadField label={t("portal.field.country")} value={countryName} />
          <ReadField label={t("portal.field.phone")} value={vendor.phone} />
          <ReadField label={t("portal.field.fax")} value={vendor.fax} />
          <ReadField
            label={t("portal.field.yearFounded")}
            value={vendor.yearFounded === null ? null : String(vendor.yearFounded)}
          />
          <ReadField label={t("portal.field.website")} value={vendor.website} />
          <ReadField label={t("portal.field.email")} value={vendor.email} />
        </>,
      )}
      {section(
        "portal.section.people",
        <>
          <ReadField label={t("portal.field.commissioner")} value={vendor.commissioner} />
          <ReadField label={t("portal.field.director")} value={vendor.director} />
          <ReadField label={t("portal.field.picName")} value={vendor.picName} />
          <ReadField label={t("portal.field.picRole")} value={vendor.picRole} />
          <ReadField label={t("portal.field.picPhone")} value={vendor.picPhone} />
          <ReadField label={t("portal.field.picEmail")} value={vendor.picEmail} />
          <ReadField label={t("portal.field.soechiReference")} value={vendor.soechiReference} />
        </>,
      )}
      {section(
        "portal.section.payment",
        <ReadField
          label={t("portal.field.paymentTerm")}
          value={enumLabel("enum.paymentTerm", vendor.paymentTerm)}
        />,
      )}
    </div>
  );
}

/** Documents tab — the required compliance set, each flagged captured/missing, with a signed preview. */
function DocumentsTab({ vendorId }: { vendorId: string }) {
  const { locale } = useLocale();
  const t = useT();
  const { toast } = useToast();
  const [required, setRequired] = useState<RequiredDocumentDTO[] | null>(null);
  const [slots, setSlots] = useState<DocumentSlotDTO[]>([]);
  const [error, setError] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setRequired(null);
    setError(false);
    Promise.all([vendorApi.requiredDocuments(locale, vendorId), docsApi.list(locale, vendorId)])
      .then(([req, sl]) => {
        if (!alive) return;
        setRequired(req);
        setSlots(sl);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [locale, vendorId]);

  const slotByMaster = useMemo(() => new Map(slots.map((s) => [s.documentMasterId, s])), [slots]);

  const preview = async (versionId: string) => {
    setPreviewing(versionId);
    try {
      const url = await docsApi.versionUrl(locale, vendorId, versionId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast({ title: e instanceof VendorApiError ? e.message : String(e), tone: "danger" });
    } finally {
      setPreviewing(null);
    }
  };

  if (error)
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {t("console.vendorProfile.loadError")}
        </CardContent>
      </Card>
    );
  if (required === null)
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {t("portal.common.loading")}
        </CardContent>
      </Card>
    );

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-5">
        {required.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("console.vendorProfile.noDocuments")}</p>
        )}
        {required.map((d) => {
          const slot = slotByMaster.get(d.documentMasterId);
          const version = slot?.currentVersion ?? null;
          return (
            <div
              key={d.documentMasterId}
              className="flex items-center justify-between gap-4 rounded-xl border border-input p-4"
            >
              <div className="flex items-center gap-3">
                <FileText weight="fill" className="shrink-0 text-primary" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">
                      {resolveLabel({ id: d.nameId, en: d.nameEn }, locale)}
                    </span>
                    {version ? (
                      // The verifier's decision on the captured version (M5.4): pending / verified /
                      // rejected — the gate status the M5.2 activation gate reads, on the vendor detail.
                      <StatusPill tone={verifyStatusTone[version.verifyStatus]}>
                        {t(`enum.verifyStatus.${version.verifyStatus}` as MessageKey)}
                      </StatusPill>
                    ) : (
                      <StatusPill tone="pending">
                        {t("console.vendorProfile.docMissing")}
                      </StatusPill>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {d.no}
                    {version
                      ? ` · ${t("console.vendorProfile.docVersion", { n: version.versionNo })}${
                          version.refNo ? ` · ${version.refNo}` : ""
                        }`
                      : ""}
                  </div>
                  {version?.expiresOn && (
                    <div className="text-xs text-muted-foreground">
                      {t("console.vendorProfile.docExpires", { date: version.expiresOn })}
                    </div>
                  )}
                  {version?.verifyStatus === "rejected" && version.rejectReason && (
                    <div className="text-xs text-destructive">
                      {t("console.vendorProfile.docRejectReason", { reason: version.rejectReason })}
                    </div>
                  )}
                </div>
              </div>
              {version && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => preview(version.id)}
                  disabled={previewing === version.id}
                >
                  {previewing === version.id
                    ? t("portal.common.loading")
                    : t("console.vendorProfile.docPreview")}
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** Bank tab — the vendor's bank accounts, read-only (primary flagged, currencies resolved to codes). */
function BankTab({ vendorId }: { vendorId: string }) {
  const { locale } = useLocale();
  const t = useT();
  const lists = useLists();
  const [banks, setBanks] = useState<BankDTO[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setBanks(null);
    setError(false);
    banksApi
      .list(locale, vendorId)
      .then((b) => {
        if (alive) setBanks(b);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [locale, vendorId]);

  const currencyCodes = (ids: string[]): string =>
    ids.map((id) => lists?.currencies.find((c) => c.id === id)?.code ?? id).join(", ");

  if (error)
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {t("console.vendorProfile.loadError")}
        </CardContent>
      </Card>
    );
  if (banks === null)
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {t("portal.common.loading")}
        </CardContent>
      </Card>
    );

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-5">
        {banks.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("console.vendorProfile.noBanks")}</p>
        )}
        {banks.map((b) => (
          <div key={b.id} className="rounded-xl border border-input p-4">
            <div className="mb-3 flex items-center gap-3">
              <Bank weight="fill" className="text-primary" />
              <span className="font-semibold text-foreground">{b.bankName}</span>
              {b.isPrimary && <StatusPill tone="info">{t("portal.bank.primaryBadge")}</StatusPill>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <ReadField label={t("portal.bank.accountNo")} value={b.accountNo} />
              <ReadField label={t("portal.bank.holderName")} value={b.holderName} />
              <ReadField label={t("portal.bank.branch")} value={b.branch} />
              <ReadField label={t("portal.bank.swift")} value={b.swift} />
              <ReadField label={t("portal.bank.currency")} value={currencyCodes(b.currencyIds)} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Activity tab — the audit trail scoped to this vendor (M1.4, #23). Rendered only with `audit:view`. */
function ActivityTab({ vendorId }: { vendorId: string }) {
  const { locale } = useLocale();
  const t = useT();
  const [rows, setRows] = useState<AuditRowDTO[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(false);
    auditApi
      .forVendor(locale, vendorId)
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [locale, vendorId]);

  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );

  if (error)
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {t("console.vendorProfile.loadError")}
        </CardContent>
      </Card>
    );
  if (rows === null)
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {t("portal.common.loading")}
        </CardContent>
      </Card>
    );

  return (
    <Card>
      <CardContent className="py-5">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("console.vendorProfile.noActivity")}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {rows.map((row) => (
              <li key={row.id} className="flex gap-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                <div className="flex-1 border-b border-border pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">{row.action}</code>
                    <span className="text-xs text-muted-foreground">
                      {timeFmt.format(new Date(row.at))}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {row.actorName ?? row.actorEmail ?? t("audit.system")}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
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
  onVendorChange,
  onSubmitted,
  onCancel,
}: {
  vendor: VendorDTO;
  onVendorChange: (v: VendorDTO) => void;
  onSubmitted: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [step, setStep] = useState(0);
  const total = STEPS.length;

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
      <aside className="hidden lg:block">
        <div className="mb-4 rounded-xl border border-input bg-card p-3">
          <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {t("console.vendorReg.landingTitle")}
          </div>
          <div className="mt-1 font-semibold text-foreground">{vendor.name}</div>
        </div>
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
        <Button variant="ghost" size="sm" className="mt-3" onClick={onCancel}>
          {t("console.vendorReg.backToStart")}
        </Button>
      </aside>

      <div className="flex flex-col gap-4">
        <div className="text-sm font-semibold text-muted-foreground">
          {t("portal.reg.stepOf", { n: step + 1, total })} ·{" "}
          {t(STEPS[step]?.titleKey ?? "console.vendorReg.landingTitle")}
        </div>

        {step === 0 && <CompanySection vendor={vendor} onSaved={onVendorChange} />}
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
  raise,
}: {
  vendor: VendorDTO;
  onSaved: (v: VendorDTO) => void;
  /**
   * Post-activation change mode (M4.6b, #67). When set, the form assembles the same profile but instead
   * of writing the (frozen) live record it hands the fields to `onSubmit`, which POSTs them as a non-bank
   * change diff. The submit button becomes "Submit change request"; the required stars are unchanged, so
   * the raised profile must still satisfy the per-origin set (the API rechecks `missingProfileFields`).
   */
  raise?: { onSubmit: (profile: Record<string, string | number>) => Promise<void> };
}) {
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

  // The filled profile fields (name always; blanks skipped, yearFounded coerced) — the shape both a Draft
  // save and a non-bank change diff carry, minus origin/source (lifecycle-owned; the server pins them).
  const assembleProfile = (): Record<string, string | number> => {
    const out: Record<string, string | number> = { name: form.name || vendor.name };
    for (const [k, v] of Object.entries(form)) {
      if (k === "name") continue;
      const trimmed = v.trim();
      if (!trimmed) continue;
      out[k] = k === "yearFounded" ? Number(trimmed) : trimmed;
    }
    return out;
  };

  const save = async () => {
    setSaving(true);
    try {
      if (raise) {
        await raise.onSubmit(assembleProfile());
      } else {
        // `source: "office"` satisfies the lenient Draft schema; the server ignores it (source is fixed
        // at create by the actor kind) but Zod requires the field, so we send the vendor's own value.
        const payload: VendorDraftPayload = {
          origin: vendor.origin,
          source: "office",
          ...assembleProfile(),
          name: form.name || vendor.name,
        };
        const updated = await vendorApi.update(locale, vendor.id, payload);
        onSaved(updated);
        toast({ title: t("portal.reg.draftSaved"), tone: "success" });
      }
    } catch (e) {
      toast({ title: e instanceof VendorApiError ? e.message : String(e), tone: "danger" });
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
          {t(raise ? "console.vendorProfile.changeSubmit" : "portal.common.saveDraft")}
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
      toast({ title: e instanceof VendorApiError ? e.message : String(e), tone: "danger" });
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
  compose,
}: {
  vendor: VendorDTO;
  currencies: CurrencyRow[];
  countries: CountryRow[];
  onClose: () => void;
  onSaved: () => void;
  /**
   * Post-activation change mode (M4.6b, #67). When set, the dialog composes a bank into a local block —
   * no live write, no fresh attachment upload (that route is frozen once a vendor leaves Draft, M4.4).
   * `initial` pre-fills for an edit (carrying its existing attachment file ids); a new account is
   * company-held (holder-proof attachments can't be added post-activation). `onCompose` receives the
   * finished account for the {@link BankBlockEditor} to append/replace; the whole set POSTs as a diff.
   */
  compose?: { initial?: BankDTO; onCompose: (bank: BankDTO) => void };
}) {
  const { locale } = useLocale();
  const t = useT();
  const { toast } = useToast();
  const [form, setForm] = useState<BankDTO>(() =>
    compose?.initial
      ? { ...compose.initial }
      : {
          bankName: "",
          accountNo: "",
          holderName: "",
          currencyIds: [],
          holderSameAsCompany: true,
          isPrimary: true,
        },
  );
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
    // Compose mode: hand the account to the block editor as-is (its file ids, if any, ride along) — no
    // live write, no upload. The whole block POSTs later as one change diff.
    if (compose) {
      compose.onCompose({ ...form });
      onClose();
      return;
    }
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
      toast({ title: e instanceof VendorApiError ? e.message : String(e), tone: "danger" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t(compose?.initial ? "console.vendorProfile.changeBankEdit" : "portal.bank.add")}
          </DialogTitle>
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

        {/* Live capture (Draft): pick the holder and upload holder-proof. In a post-activation change the
            attachment route is frozen, so the holder relationship is fixed at its current value and no
            uploads are offered — only a note explaining it. */}
        {!compose && (
          <>
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
          </>
        )}

        {compose && (
          <p className="mt-2 rounded-xl border border-input bg-secondary/40 p-3 text-xs text-muted-foreground">
            {t(
              form.holderSameAsCompany
                ? "console.vendorProfile.changeBankHolderNote"
                : "console.vendorProfile.changeBankAttachRetained",
            )}
          </p>
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
      toast({ title: e instanceof VendorApiError ? e.message : String(e), tone: "danger" });
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

/* ── Section 4: Review + submit → Pending-HOD ─────────────────────────────────────────────────── */

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
    // The gate only reads field presence + origin/countryId — the console DTO's looser `string` enums
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
      toast({ title: t("console.vendorReg.successTitle"), tone: "success" });
      onSubmitted();
    } catch (e) {
      if (e instanceof VendorApiError && e.messageKey === "error.vendor.taxIdDuplicate") {
        setConflictMsg(e.message);
      } else {
        toast({ title: e instanceof VendorApiError ? e.message : String(e), tone: "danger" });
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

        <HodNotice />

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

        <p className="text-xs text-muted-foreground">{t("console.vendorReg.reviewNote")}</p>

        <div>
          <Button onClick={submit} disabled={submitting || !readiness?.ok}>
            {t("console.vendorReg.submit")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
