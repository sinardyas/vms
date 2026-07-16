/**
 * Document Verification — the M5.4 console UX (#71) over the M5.1 verifier engine
 * (`/console/document-verification`, #68, ADR-0007/0013/0014).
 *
 * The Document Verifier's own review surface, distinct from the vendor-owned capture screen (M3.7): a
 * **queue** of still-pending document versions on vendors under review (Pending), each viewable through a
 * MinIO **signed URL** before a decision, and the two per-document actions — **verify** (recording the
 * certificate's issue/expiry dates) and **reject** (required reason). Rejecting a *mandatory* document
 * bounces the vendor's registration back to Draft (M5.3); the surface says so.
 *
 * Every string is localised through `useT`; the screen is gated `documents:view` (the nav gate + the
 * route guard), and the verify/reject actions on `documents:approve` via `useCan` — the same grants the
 * routes enforce, so a viewer sees the queue but no action buttons (SoD: a verifier holds `documents`,
 * not `approvals`, and vice-versa — M1.6/ADR-0014).
 */

import { ArrowClockwise, Check, Eye, FileText, Warning, X } from "@phosphor-icons/react";
import type { MessageKey } from "@vms/domain";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  useCan,
  useLocale,
  useT,
  useToast,
} from "@vms/ui";
import { useCallback, useEffect, useState } from "react";
import {
  type VendorApiError,
  type VerificationQueueItem,
  verificationApi,
} from "../lib/document-verification";

/* ── Helpers ──────────────────────────────────────────────────────────────────────────────────── */

/** Pick a document's label in the active locale (both are carried on the queue item). */
const docLabel = (locale: string, item: VerificationQueueItem): string =>
  (locale === "id" ? item.documentNameId : item.documentNameEn) ??
  item.documentNameEn ??
  item.documentNameId;

/* ── Root ─────────────────────────────────────────────────────────────────────────────────────── */

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; items: VerificationQueueItem[] };

export function DocumentVerification() {
  const t = useT();
  const { locale } = useLocale();
  const [state, setState] = useState<State>({ status: "loading" });
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", items: await verificationApi.queue(locale) });
    } catch {
      setState({ status: "error" });
    }
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const openItem =
    state.status === "ready" ? (state.items.find((i) => i.versionId === openId) ?? null) : null;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{t("console.verification.title")}</CardTitle>
          <CardDescription>{t("console.verification.subtitle")}</CardDescription>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void load()}
          disabled={state.status === "loading"}
        >
          <ArrowClockwise weight="bold" />
          {t("console.verification.refresh")}
        </Button>
      </CardHeader>

      <CardContent>
        {state.status === "error" ? (
          <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
            <Warning weight="fill" />
            {t("console.verification.loadError")}
          </div>
        ) : (
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("console.verification.col.vendor")}</TableHead>
                  <TableHead>{t("console.verification.col.document")}</TableHead>
                  <TableHead>{t("console.verification.col.version")}</TableHead>
                  <TableHead>{t("console.verification.col.uploaded")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.status === "loading" ? (
                  <TableEmpty colSpan={4}>{t("console.verification.loading")}</TableEmpty>
                ) : state.items.length === 0 ? (
                  <TableEmpty colSpan={4}>{t("console.verification.empty")}</TableEmpty>
                ) : (
                  state.items.map((item) => (
                    <TableRow
                      key={item.versionId}
                      className="cursor-pointer"
                      onClick={() => setOpenId(item.versionId)}
                    >
                      <TableCell className="font-medium">{item.vendorName}</TableCell>
                      <TableCell>
                        <div className="flex items-start gap-2">
                          <FileText weight="fill" className="mt-0.5 shrink-0 text-primary" />
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span>{docLabel(locale, item)}</span>
                              <Badge tone={item.documentMandatory ? "navy" : "neutral"}>
                                {item.documentMandatory
                                  ? t("console.verification.badge.mandatory")
                                  : t("console.verification.badge.optional")}
                              </Badge>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {item.documentNo}
                              {item.refNo
                                ? ` · ${t("console.verification.refNo", { ref: item.refNo })}`
                                : ""}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {t("console.verification.versionNo", { n: item.versionNo })}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {dateFmt.format(new Date(item.uploadedAt))}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>

      {openItem && (
        <DecisionDialog
          item={openItem}
          onClose={() => setOpenId(null)}
          onDecided={() => {
            setOpenId(null);
            void load();
          }}
        />
      )}
    </Card>
  );
}

/* ── Decision dialog ──────────────────────────────────────────────────────────────────────────── */

/** Which decide form is open inside the dialog. */
type Action = "verify" | "reject" | null;

function DecisionDialog({
  item,
  onClose,
  onDecided,
}: { item: VerificationQueueItem; onClose: () => void; onDecided: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const { toast } = useToast();
  const canDecide = useCan("documents", "approve");
  const [action, setAction] = useState<Action>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(false);

  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  /** Open the document in a new tab via a fresh signed URL, surfacing any error as a toast. */
  const view = async () => {
    setViewing(true);
    try {
      const url = await verificationApi.versionUrl(locale, item.versionId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      const err = e as VendorApiError;
      toast({ title: err.message || t("console.verification.viewError"), tone: "danger" });
    } finally {
      setViewing(false);
    }
  };

  /** Run a decide call; on success toast (+ a Draft-bounce notice for a mandatory reject) then refresh. */
  const run = async (
    fn: () => Promise<{ returnedToDraft?: boolean } | unknown>,
    successKey: MessageKey,
  ) => {
    setBusy(true);
    try {
      const result = (await fn()) as { returnedToDraft?: boolean };
      toast({ title: t(successKey), tone: "success" });
      if (result?.returnedToDraft) {
        toast({ title: t("console.verification.toast.returnedToDraft"), tone: "info" });
      }
      onDecided();
    } catch (e) {
      const err = e as VendorApiError;
      toast({ title: err.message || t("console.verification.toast.error"), tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{docLabel(locale, item)}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Document summary */}
          <section className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium">{item.vendorName}</span>
              <Badge tone={item.documentMandatory ? "navy" : "neutral"}>
                {item.documentMandatory
                  ? t("console.verification.badge.mandatory")
                  : t("console.verification.badge.optional")}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              {item.documentNo} · {t("console.verification.versionNo", { n: item.versionNo })}
              {item.refNo ? ` · ${t("console.verification.refNo", { ref: item.refNo })}` : ""}
              {item.variant
                ? ` · ${t("console.verification.variant", { variant: item.variant })}`
                : ""}
            </div>
            <div className="text-xs text-muted-foreground">
              {dateFmt.format(new Date(item.uploadedAt))}
            </div>
          </section>

          <Button variant="secondary" size="sm" onClick={() => void view()} disabled={viewing}>
            <Eye weight="bold" />
            {t("console.verification.action.view")}
          </Button>

          {/* Decide actions / forms */}
          {canDecide && action === null && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => setAction("verify")}>
                <Check weight="bold" />
                {t("console.verification.action.verify")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => setAction("reject")}
              >
                <X weight="bold" />
                {t("console.verification.action.reject")}
              </Button>
            </div>
          )}

          {canDecide && action === "verify" && (
            <VerifyForm
              busy={busy}
              onCancel={() => setAction(null)}
              onSubmit={(dates) =>
                run(
                  () => verificationApi.verify(locale, item.versionId, dates),
                  "console.verification.toast.verified",
                )
              }
            />
          )}

          {canDecide && action === "reject" && (
            <RejectForm
              mandatory={item.documentMandatory}
              busy={busy}
              onCancel={() => setAction(null)}
              onSubmit={(reason) =>
                run(
                  () => verificationApi.reject(locale, item.versionId, reason),
                  "console.verification.toast.rejected",
                )
              }
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("console.verification.action.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Decide forms ─────────────────────────────────────────────────────────────────────────────── */

function VerifyForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (dates: { issuedOn?: string; expiresOn?: string }) => void;
}) {
  const t = useT();
  const [issued, setIssued] = useState("");
  const [expires, setExpires] = useState("");
  // Both dates are optional (the verifier may not have them); if both are given, expiry ≥ issue.
  const dateError = issued !== "" && expires !== "" && expires < issued;

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <h3 className="text-sm font-semibold">{t("console.verification.verify.title")}</h3>
      <p className="text-xs text-muted-foreground">{t("console.verification.verify.hint")}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("console.verification.verify.issued")}>
          {(f) => (
            <Input {...f} type="date" value={issued} onChange={(e) => setIssued(e.target.value)} />
          )}
        </Field>
        <Field label={t("console.verification.verify.expires")}>
          {(f) => (
            <Input
              {...f}
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
            />
          )}
        </Field>
      </div>
      {dateError && (
        <p className="text-xs text-destructive">{t("console.verification.verify.dateError")}</p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          {t("console.verification.action.cancel")}
        </Button>
        <Button
          size="sm"
          disabled={busy || dateError}
          onClick={() =>
            onSubmit({ issuedOn: issued || undefined, expiresOn: expires || undefined })
          }
        >
          {t("console.verification.verify.confirm")}
        </Button>
      </div>
    </div>
  );
}

function RejectForm({
  mandatory,
  busy,
  onCancel,
  onSubmit,
}: {
  mandatory: boolean;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const t = useT();
  const [reason, setReason] = useState("");
  const blocked = busy || reason.trim() === "";

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <h3 className="text-sm font-semibold">{t("console.verification.reject.title")}</h3>
      {mandatory && (
        <div className="flex items-start gap-2 rounded-lg bg-warning/10 p-2 text-xs text-warning-foreground">
          <Warning weight="fill" className="mt-0.5 shrink-0" />
          {t("console.verification.reject.mandatoryNote")}
        </div>
      )}
      <Field label={t("console.verification.reject.reason")}>
        {(f) => (
          <Textarea {...f} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          {t("console.verification.action.cancel")}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={blocked}
          onClick={() => onSubmit(reason.trim())}
        >
          {t("console.verification.reject.confirm")}
        </Button>
      </div>
    </div>
  );
}
