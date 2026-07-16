/**
 * Approvals — the M4.6 console UX (#61) over the M4.2 engine (`/console/approvals`, #57).
 *
 * The acting surface for approvers: a queue with three lenses — **My Queue** (steps assigned to me),
 * **Role Queue** (steps routed to a role I hold — the shared team inbox), and **All Open** — and a
 * request **detail** showing the subject, the ordered **route step progress** (each step's role,
 * assignee, decision, and any admin override), the **proposed diff** for a post-activation edit (M4.5),
 * and a placeholder for the M5 document-verification progress. From the detail an approver can
 * **approve** (optional note), **reject** (required reason), or **reassign/delegate** the current step
 * to another holder of its role.
 *
 * Every string is localised through `useT`; the decide actions are gated on `approvals:approve` via
 * `useCan` (the same grant the routes enforce), so a viewer sees the queue but no action buttons.
 */

import { ArrowClockwise, ArrowsClockwise, Check, Warning, X } from "@phosphor-icons/react";
import type { MessageKey, VendorChangeInput } from "@vms/domain";
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
  StatusPill,
  type StatusPillProps,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  useCan,
  useLocale,
  useT,
  useToast,
} from "@vms/ui";
import { useCallback, useEffect, useState } from "react";
import {
  type ActivationGateDTO,
  type ApprovalRequestDetailDTO,
  type ApprovalRequestSummaryDTO,
  type ApprovalStepDTO,
  type AssigneeCandidateDTO,
  type QueueScope,
  type VendorApiError,
  approvalsApi,
} from "../lib/approvals";

/* ── Label + tone helpers ─────────────────────────────────────────────────────────────────────── */

const triggerKey = (trigger: string): MessageKey => `enum.approvalTrigger.${trigger}` as MessageKey;
const decisionKey = (d: ApprovalStepDTO["decision"]): MessageKey =>
  `enum.stepDecision.${d}` as MessageKey;
/** A request's status (pending / approved / rejected / recalled) → its i18n label. */
const reqStatusKey = (status: string): MessageKey => `enum.approvalStatus.${status}` as MessageKey;
const reqStatusTone = (status: string): StatusPillProps["tone"] =>
  status === "approved"
    ? "success"
    : status === "rejected"
      ? "danger"
      : status === "pending"
        ? "pending"
        : "neutral";

/** Pick a role's label in the active locale (both are carried on the DTO). */
const roleLabel = (locale: string, nameId: string | null, nameEn: string | null): string =>
  (locale === "id" ? nameId : nameEn) ?? nameEn ?? nameId ?? "—";

/** A step's decision → traffic-light tone (pending amber, approved green, rejected red). */
const decisionTone = (d: ApprovalStepDTO["decision"]): StatusPillProps["tone"] =>
  d === "approved" ? "success" : d === "rejected" ? "danger" : "pending";

/* ── Root ─────────────────────────────────────────────────────────────────────────────────────── */

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; items: ApprovalRequestSummaryDTO[] };

export function Approvals() {
  const t = useT();
  const { locale } = useLocale();
  const [scope, setScope] = useState<QueueScope>("mine");
  const [state, setState] = useState<State>({ status: "loading" });
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", items: await approvalsApi.list(locale, scope) });
    } catch {
      setState({ status: "error" });
    }
  }, [locale, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const emptyKey: MessageKey =
    scope === "mine"
      ? "console.approvals.empty.mine"
      : scope === "role"
        ? "console.approvals.empty.role"
        : "console.approvals.empty.all";

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{t("console.approvals.title")}</CardTitle>
          <CardDescription>{t("console.approvals.subtitle")}</CardDescription>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void load()}
          disabled={state.status === "loading"}
        >
          <ArrowClockwise weight="bold" />
          {t("console.approvals.refresh")}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        <Tabs value={scope} onValueChange={(v) => setScope(v as QueueScope)}>
          <TabsList>
            <TabsTrigger value="mine">{t("console.approvals.tab.mine")}</TabsTrigger>
            <TabsTrigger value="role">{t("console.approvals.tab.role")}</TabsTrigger>
            <TabsTrigger value="all">{t("console.approvals.tab.all")}</TabsTrigger>
          </TabsList>
        </Tabs>

        {state.status === "error" ? (
          <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
            <Warning weight="fill" />
            {t("console.approvals.loadError")}
          </div>
        ) : (
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("console.approvals.col.vendor")}</TableHead>
                  <TableHead>{t("console.approvals.col.type")}</TableHead>
                  <TableHead>{t("console.approvals.col.step")}</TableHead>
                  <TableHead>{t("console.approvals.col.assignee")}</TableHead>
                  <TableHead>{t("console.approvals.col.submitted")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.status === "loading" ? (
                  <TableEmpty colSpan={5}>{t("console.approvals.loading")}</TableEmpty>
                ) : state.items.length === 0 ? (
                  <TableEmpty colSpan={5}>{t(emptyKey)}</TableEmpty>
                ) : (
                  state.items.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpenId(r.id)}>
                      <TableCell className="font-medium">{r.vendorName}</TableCell>
                      <TableCell>
                        <Badge tone="navy">{t(triggerKey(r.trigger))}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>
                            {roleLabel(locale, r.currentStepRoleNameId, r.currentStepRoleNameEn)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t("console.approvals.stepOf", { n: r.currentStepNo, total: "—" })}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {r.currentAssigneeName ? (
                          r.currentAssigneeName
                        ) : (
                          <span className="text-muted-foreground">
                            {t("console.approvals.unassigned")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {dateFmt.format(new Date(r.createdAt))}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>

      {openId && (
        <RequestDetailDialog
          id={openId}
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

/* ── Detail dialog ────────────────────────────────────────────────────────────────────────────── */

type DetailState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; detail: ApprovalRequestDetailDTO };

/** Which decide form is open inside the detail dialog. */
type Action = "approve" | "reject" | "reassign" | null;

function RequestDetailDialog({
  id,
  onClose,
  onDecided,
}: { id: string; onClose: () => void; onDecided: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const { toast } = useToast();
  const canApprove = useCan("approvals", "approve");
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [action, setAction] = useState<Action>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", detail: await approvalsApi.get(locale, id) });
    } catch {
      setState({ status: "error" });
    }
  }, [locale, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const detail = state.status === "ready" ? state.detail : null;
  const decidable = canApprove && detail?.status === "pending";
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  /** Run a decide call, surfacing its localized error as a toast; on success let the parent refresh. */
  const run = async (fn: () => Promise<unknown>, successKey: MessageKey) => {
    setBusy(true);
    try {
      await fn();
      toast({ title: t(successKey), tone: "success" });
      onDecided();
    } catch (e) {
      const err = e as VendorApiError;
      toast({ title: err.message || t("console.approvals.toast.error"), tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{detail?.vendorName ?? t("console.approvals.title")}</DialogTitle>
        </DialogHeader>

        {state.status === "loading" ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("console.approvals.loading")}
          </p>
        ) : state.status === "error" ? (
          <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
            <Warning weight="fill" />
            {t("console.approvals.loadError")}
          </div>
        ) : detail ? (
          <div className="space-y-6">
            {/* Subject summary */}
            <section className="grid grid-cols-2 gap-3 text-sm">
              <Summary label={t("console.approvals.detail.type")}>
                <Badge tone="navy">{t(triggerKey(detail.trigger))}</Badge>
              </Summary>
              <Summary label={t("console.approvals.detail.status")}>
                <StatusPill tone={reqStatusTone(detail.status)}>
                  {t(reqStatusKey(detail.status))}
                </StatusPill>
              </Summary>
              <Summary label={t("console.approvals.col.step")}>
                {t("console.approvals.stepOf", {
                  n: detail.currentStepNo,
                  total: detail.steps.length,
                })}
              </Summary>
              <Summary label={t("console.approvals.detail.raisedAt")}>
                {dateFmt.format(new Date(detail.createdAt))}
              </Summary>
            </section>

            {/* Proposed diff (post-activation edit only) */}
            {detail.payload && <ChangeDiff payload={detail.payload} />}

            {/* Route step progress */}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t("console.approvals.detail.route")}</h3>
              <ol className="space-y-2">
                {detail.steps.map((s) => (
                  <StepRow
                    key={s.stepNo}
                    step={s}
                    isCurrent={s.stepNo === detail.currentStepNo && detail.status === "pending"}
                  />
                ))}
              </ol>
            </section>

            {/* M5.2 activation-gate status (registration requests only) */}
            {detail.activationGate && <VerificationProgress gate={detail.activationGate} />}

            {/* Decide actions / forms */}
            {decidable && action === null && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy} onClick={() => setAction("approve")}>
                  <Check weight="bold" />
                  {t("console.approvals.action.approve")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setAction("reject")}
                >
                  <X weight="bold" />
                  {t("console.approvals.action.reject")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setAction("reassign")}
                >
                  <ArrowsClockwise weight="bold" />
                  {t("console.approvals.action.reassign")}
                </Button>
              </div>
            )}

            {decidable && action === "approve" && (
              <NoteForm
                titleKey="console.approvals.approve.title"
                labelKey="console.approvals.approve.note"
                confirmKey="console.approvals.approve.confirm"
                required={false}
                busy={busy}
                onCancel={() => setAction(null)}
                onSubmit={(note) =>
                  run(
                    () => approvalsApi.approve(locale, id, note || undefined),
                    "console.approvals.toast.approved",
                  )
                }
              />
            )}

            {decidable && action === "reject" && (
              <NoteForm
                titleKey="console.approvals.reject.title"
                labelKey="console.approvals.reject.reason"
                confirmKey="console.approvals.reject.confirm"
                confirmTone="destructive"
                required
                busy={busy}
                onCancel={() => setAction(null)}
                onSubmit={(reason) =>
                  run(
                    () => approvalsApi.reject(locale, id, reason),
                    "console.approvals.toast.rejected",
                  )
                }
              />
            )}

            {decidable && action === "reassign" && (
              <ReassignForm
                requestId={id}
                stepNo={detail.currentStepNo}
                busy={busy}
                onCancel={() => setAction(null)}
                onSubmit={(userId) =>
                  run(
                    () => approvalsApi.reassign(locale, id, detail.currentStepNo, userId),
                    "console.approvals.toast.reassigned",
                  )
                }
              />
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("console.approvals.action.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Summary({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div>{children}</div>
    </div>
  );
}

function StepRow({ step, isCurrent }: { step: ApprovalStepDTO; isCurrent: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <li
      className={`flex items-start justify-between gap-3 rounded-xl border p-3 ${
        isCurrent ? "border-primary bg-primary/5" : "border-border"
      }`}
    >
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">{step.stepNo}.</span>
          <span className="font-medium">{roleLabel(locale, step.roleNameId, step.roleNameEn)}</span>
          {step.isOverride && <Badge tone="warning">{t("console.approvals.step.override")}</Badge>}
        </div>
        {step.decision !== "pending" && step.decidedByName && (
          <p className="text-xs text-muted-foreground">
            {t("console.approvals.step.by", { name: step.decidedByName })}
          </p>
        )}
        {step.reason && (
          <p className="text-xs text-muted-foreground">
            {t("console.approvals.step.reason", { reason: step.reason })}
          </p>
        )}
        {step.decision === "pending" && step.assigneeName && (
          <p className="text-xs text-muted-foreground">
            {t("console.approvals.step.by", { name: step.assigneeName })}
          </p>
        )}
      </div>
      <StatusPill tone={decisionTone(step.decision)}>
        {isCurrent && step.decision === "pending"
          ? t("console.approvals.step.awaiting")
          : t(decisionKey(step.decision))}
      </StatusPill>
    </li>
  );
}

/**
 * The M5.2 activation-gate status on a registration request (M5.4, #71) — "N of M mandatory documents
 * verified" with a progress bar and, when blocked, how many are still awaiting the verifier. This is what
 * final-approve is gated on (ADR-0013); it replaces the M4.6 placeholder that stood here.
 */
function VerificationProgress({ gate }: { gate: ActivationGateDTO }) {
  const t = useT();
  const pct =
    gate.requiredCount === 0 ? 100 : Math.round((gate.verifiedCount / gate.requiredCount) * 100);
  return (
    <section
      className={`space-y-2 rounded-xl border p-3 ${
        gate.ok ? "border-success/40 bg-success/5" : "border-warning/40 bg-warning/5"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("console.approvals.detail.verification")}</h3>
        {gate.requiredCount > 0 && (
          <StatusPill tone={gate.ok ? "success" : "pending"}>
            {t("console.approvals.detail.verifiedCount", {
              n: gate.verifiedCount,
              total: gate.requiredCount,
            })}
          </StatusPill>
        )}
      </div>
      {gate.requiredCount === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("console.approvals.detail.verificationNone")}
        </p>
      ) : (
        <>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full rounded-full ${gate.ok ? "bg-success" : "bg-warning"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {gate.ok
              ? t("console.approvals.detail.verificationComplete")
              : t("console.approvals.detail.verificationBlocked", {
                  n: gate.requiredCount - gate.verifiedCount,
                })}
          </p>
        </>
      )}
    </section>
  );
}

/** Render a post-activation edit's proposed diff — a profile replacement or a new bank block. */
function ChangeDiff({ payload }: { payload: VendorChangeInput }) {
  const t = useT();
  if (payload.kind === "non_bank") {
    const entries = Object.entries(payload.profile).filter(
      ([, v]) => v !== null && v !== undefined && v !== "",
    );
    return (
      <section className="space-y-2 rounded-xl border border-info/40 bg-info/5 p-3">
        <h3 className="text-sm font-semibold">{t("console.approvals.detail.changeProfile")}</h3>
        <dl className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
          {entries.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <dt className="font-mono text-xs text-muted-foreground">{k}</dt>
              <dd className="text-right">{String(v)}</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }
  return (
    <section className="space-y-2 rounded-xl border border-info/40 bg-info/5 p-3">
      <h3 className="text-sm font-semibold">{t("console.approvals.detail.changeBanks")}</h3>
      <ul className="space-y-2">
        {payload.banks.map((b, i) => (
          <li key={`${b.accountNo}-${i}`} className="rounded-lg bg-background p-2 text-sm">
            <div className="flex items-center gap-2 font-medium">
              {b.bankName}
              {b.isPrimary && (
                <StatusPill tone="info">{t("console.approvals.bank.primary")}</StatusPill>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {b.accountNo} · {b.holderName}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── Decide forms ─────────────────────────────────────────────────────────────────────────────── */

function NoteForm({
  titleKey,
  labelKey,
  confirmKey,
  confirmTone = "primary",
  required,
  busy,
  onCancel,
  onSubmit,
}: {
  titleKey: MessageKey;
  labelKey: MessageKey;
  confirmKey: MessageKey;
  confirmTone?: "primary" | "destructive";
  required: boolean;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (note: string) => void;
}) {
  const t = useT();
  const [note, setNote] = useState("");
  const blocked = busy || (required && note.trim() === "");
  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <h3 className="text-sm font-semibold">{t(titleKey)}</h3>
      <Field label={t(labelKey)}>
        {(f) => <Textarea {...f} value={note} onChange={(e) => setNote(e.target.value)} rows={3} />}
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          {t("console.approvals.action.cancel")}
        </Button>
        <Button
          size="sm"
          variant={confirmTone === "destructive" ? "destructive" : "primary"}
          disabled={blocked}
          onClick={() => onSubmit(note.trim())}
        >
          {t(confirmKey)}
        </Button>
      </div>
    </div>
  );
}

function ReassignForm({
  requestId,
  stepNo,
  busy,
  onCancel,
  onSubmit,
}: {
  requestId: string;
  stepNo: number;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (userId: string) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [candidates, setCandidates] = useState<AssigneeCandidateDTO[] | null>(null);
  const [picked, setPicked] = useState("");

  useEffect(() => {
    let live = true;
    void approvalsApi
      .candidates(locale, requestId, stepNo)
      .then((c) => live && setCandidates(c))
      .catch(() => live && setCandidates([]));
    return () => {
      live = false;
    };
  }, [locale, requestId, stepNo]);

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <h3 className="text-sm font-semibold">{t("console.approvals.reassign.title")}</h3>
      {candidates === null ? (
        <p className="text-sm text-muted-foreground">{t("console.approvals.loading")}</p>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("console.approvals.reassign.none")}</p>
      ) : (
        <Field label={t("console.approvals.reassign.pick")}>
          {(f) => (
            <select
              {...f}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              value={picked}
              onChange={(e) => setPicked(e.target.value)}
            >
              <option value="">—</option>
              {candidates.map((c) => (
                <option key={c.userId} value={c.userId}>
                  {c.name} ({c.email})
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          {t("console.approvals.action.cancel")}
        </Button>
        <Button size="sm" disabled={busy || picked === ""} onClick={() => onSubmit(picked)}>
          {t("console.approvals.reassign.confirm")}
        </Button>
      </div>
    </div>
  );
}
