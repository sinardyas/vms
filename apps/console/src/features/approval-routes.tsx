import { ArrowDown, ArrowUp, Plus, Warning, X } from "@phosphor-icons/react";
import { APPROVAL_TRIGGERS, type Locale, type MessageKey, resolveLabel } from "@vms/domain";
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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  useCan,
  useLocale,
  useT,
  useToast,
} from "@vms/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApprovalRouteApiError,
  type ApprovalRouteRow,
  type RolePickRow,
  type RouteStepRow,
  createRoute,
  deactivateRoute,
  listRoles,
  listRoutes,
  listSteps,
  reactivateRoute,
  replaceSteps,
  updateRoute,
} from "../lib/approval-routes";

/**
 * Approval Routes (M2.4, #35, ADR-0009/0011) — the console screen for the trigger→ordered-steps routing
 * table the M4 workflow engine resolves, gated on `approval_routes` (`useCan(...)`, the same module the
 * routes enforce). One row per route: its trigger, bilingual name, and the ordered role chips that
 * decide each step. Two editors:
 *
 *   - **Header dialog** — the M2.1 master CRUD surface (#32): create (unused trigger + bilingual name)
 *     or rename; deactivating a route stops it routing new requests while in-flight ones keep resolving.
 *   - **Steps editor** — the bespoke ordered-role editor: add / remove / reorder the approver roles.
 *     Saving runs the server's deadlock guard (ADR-0011b); a step whose role has no eligible approver
 *     comes back as a re-confirmable warning ("Save anyway").
 */

const SELECT_CLASS =
  "h-11 w-full rounded-xl border border-input bg-card px-3.5 text-sm font-medium text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/30";

const bilingualName = (row: { nameId: string; nameEn: string }, locale: Locale): string =>
  resolveLabel({ id: row.nameId, en: row.nameEn }, locale);

// --- Header dialog (create / rename) ------------------------------------------------------------

type HeaderForm = { trigger: string; nameId: string; nameEn: string };

function HeaderDialog({
  open,
  onOpenChange,
  editing,
  usedTriggers,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: ApprovalRouteRow | null;
  usedTriggers: Set<string>;
  onSaved: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { toast } = useToast();

  // The triggers still without a route (create picks from these; one route per trigger).
  const freeTriggers = useMemo(
    () => APPROVAL_TRIGGERS.filter((tr) => !usedTriggers.has(tr)),
    [usedTriggers],
  );
  const [form, setForm] = useState<HeaderForm>({ trigger: "", nameId: "", nameEn: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      editing
        ? { trigger: editing.trigger, nameId: editing.nameId, nameEn: editing.nameEn }
        : { trigger: freeTriggers[0] ?? "", nameId: "", nameEn: "" },
    );
  }, [open, editing, freeTriggers]);

  const set = <K extends keyof HeaderForm>(key: K, value: HeaderForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const valid =
    form.nameId.trim().length > 0 &&
    form.nameEn.trim().length > 0 &&
    (!!editing || form.trigger.length > 0);
  const listName = t("approvalRoutes.title");

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await updateRoute(locale, editing.id, {
          nameId: form.nameId.trim(),
          nameEn: form.nameEn.trim(),
        });
      } else {
        await createRoute(locale, {
          trigger: form.trigger,
          nameId: form.nameId.trim(),
          nameEn: form.nameEn.trim(),
        });
      }
      toast({ title: t("regLists.saved"), tone: "success" });
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setError(e instanceof ApprovalRouteApiError ? e.message : t("regLists.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing
              ? t("regLists.editTitle", { list: listName })
              : t("regLists.createTitle", { list: listName })}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field label={t("approvalRoutes.col.trigger")} required={!editing}>
            {(p) => (
              <select
                {...p}
                className={SELECT_CLASS}
                value={form.trigger}
                disabled={!!editing}
                onChange={(e) => set("trigger", e.target.value)}
              >
                {editing ? (
                  <option value={form.trigger}>
                    {t(`enum.approvalTrigger.${form.trigger}` as MessageKey)}
                  </option>
                ) : (
                  freeTriggers.map((tr) => (
                    <option key={tr} value={tr}>
                      {t(`enum.approvalTrigger.${tr}` as MessageKey)}
                    </option>
                  ))
                )}
              </select>
            )}
          </Field>
          <Field label={t("regLists.f.nameId")} required>
            {(p) => (
              <Input {...p} value={form.nameId} onChange={(e) => set("nameId", e.target.value)} />
            )}
          </Field>
          <Field label={t("regLists.f.nameEn")} required>
            {(p) => (
              <Input {...p} value={form.nameEn} onChange={(e) => set("nameEn", e.target.value)} />
            )}
          </Field>

          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
              <Warning weight="fill" />
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("regLists.cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={saving || !valid}>
            {saving ? t("regLists.saving") : t("regLists.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Steps editor -------------------------------------------------------------------------------

function StepsDialog({
  open,
  onOpenChange,
  route,
  roles,
  initialSteps,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  route: ApprovalRouteRow | null;
  roles: RolePickRow[];
  initialSteps: RouteStepRow[];
  onSaved: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { toast } = useToast();

  // The ordered role ids being edited. "" is an unpicked slot (blocks save until chosen).
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A pending deadlock warning: the localized message + the roleIds it was raised for (re-send w/ confirm).
  const [deadlock, setDeadlock] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDeadlock(null);
    setRoleIds(initialSteps.map((s) => s.roleId));
  }, [open, initialSteps]);

  const setAt = (i: number, value: string) => {
    setDeadlock(null);
    setRoleIds((prev) => prev.map((r, idx) => (idx === i ? value : r)));
  };
  const addStep = () => {
    setDeadlock(null);
    setRoleIds((prev) => [...prev, ""]);
  };
  const removeStep = (i: number) => {
    setDeadlock(null);
    setRoleIds((prev) => prev.filter((_, idx) => idx !== i));
  };
  const move = (i: number, delta: number) => {
    setDeadlock(null);
    setRoleIds((prev) => {
      const next = [...prev];
      const j = i + delta;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const valid = roleIds.length > 0 && roleIds.every((r) => r.length > 0);

  const save = async (confirm: boolean) => {
    if (!route) return;
    setSaving(true);
    setError(null);
    try {
      await replaceSteps(locale, route.id, roleIds, confirm);
      toast({ title: t("regLists.saved"), tone: "success" });
      onOpenChange(false);
      onSaved();
    } catch (e) {
      if (e instanceof ApprovalRouteApiError && e.status === 422) {
        setDeadlock(e.message); // re-confirmable: show the warning + a "Save anyway" action
      } else {
        setError(e instanceof ApprovalRouteApiError ? e.message : t("regLists.saveError"));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("approvalRoutes.stepsTitle", {
              route: route ? bilingualName(route, locale) : "",
            })}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {roleIds.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("approvalRoutes.needStep")}</p>
          ) : (
            roleIds.map((roleId, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional (step order is the identity).
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1">
                  <Field label={t("approvalRoutes.stepN", { n: i + 1 })} required>
                    {(p) => (
                      <select
                        {...p}
                        className={SELECT_CLASS}
                        value={roleId}
                        onChange={(e) => setAt(i, e.target.value)}
                      >
                        <option value="">{t("approvalRoutes.rolePlaceholder")}</option>
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {bilingualName(r, locale)}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                </div>
                <div className="flex gap-1 pb-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={i === 0}
                    aria-label={t("approvalRoutes.moveUp")}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp weight="bold" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={i === roleIds.length - 1}
                    aria-label={t("approvalRoutes.moveDown")}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown weight="bold" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("approvalRoutes.removeStep")}
                    onClick={() => removeStep(i)}
                  >
                    <X weight="bold" />
                  </Button>
                </div>
              </div>
            ))
          )}

          <div>
            <Button variant="secondary" size="sm" onClick={addStep}>
              <Plus weight="bold" />
              {t("approvalRoutes.addStep")}
            </Button>
          </div>

          {deadlock && (
            <div className="flex flex-col gap-2 rounded-xl bg-warning/10 p-3 text-sm text-foreground">
              <div className="flex items-center gap-2 font-medium text-warning-foreground">
                <Warning weight="fill" />
                {t("approvalRoutes.deadlock.title")}
              </div>
              <p className="text-muted-foreground">{deadlock}</p>
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
              <Warning weight="fill" />
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("regLists.cancel")}
          </Button>
          {deadlock ? (
            <Button variant="destructive" onClick={() => void save(true)} disabled={saving}>
              {saving ? t("regLists.saving") : t("approvalRoutes.deadlock.confirm")}
            </Button>
          ) : (
            <Button onClick={() => void save(false)} disabled={saving || !valid}>
              {saving ? t("regLists.saving") : t("regLists.save")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Screen -------------------------------------------------------------------------------------

export function ApprovalRoutes() {
  const t = useT();
  const { locale } = useLocale();
  const { toast } = useToast();
  const canAdd = useCan("approval_routes", "add");
  const canEdit = useCan("approval_routes", "edit");
  const canDelete = useCan("approval_routes", "delete");

  const [routes, setRoutes] = useState<ApprovalRouteRow[] | null>(null);
  const [stepsByRoute, setStepsByRoute] = useState<Record<string, RouteStepRow[]>>({});
  const [roles, setRolesList] = useState<RolePickRow[]>([]);
  const [failed, setFailed] = useState(false);

  const [headerOpen, setHeaderOpen] = useState(false);
  const [editingHeader, setEditingHeader] = useState<ApprovalRouteRow | null>(null);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [stepsRoute, setStepsRoute] = useState<ApprovalRouteRow | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [rs, rl] = await Promise.all([listRoutes(locale), listRoles(locale)]);
      const stepLists = await Promise.all(rs.map((r) => listSteps(locale, r.id)));
      const byRoute: Record<string, RouteStepRow[]> = {};
      rs.forEach((r, i) => {
        byRoute[r.id] = stepLists[i];
      });
      setRoutes(rs);
      setStepsByRoute(byRoute);
      setRolesList(rl);
    } catch {
      setFailed(true);
    }
  }, [locale]);
  useEffect(() => {
    void load();
  }, [load]);

  const usedTriggers = useMemo(() => new Set((routes ?? []).map((r) => r.trigger)), [routes]);

  const toggleActive = async (row: ApprovalRouteRow) => {
    try {
      if (row.active) await deactivateRoute(locale, row.id);
      else await reactivateRoute(locale, row.id);
      toast({ title: t("regLists.saved"), tone: "success" });
      await load();
    } catch (e) {
      toast({
        title: e instanceof ApprovalRouteApiError ? e.message : t("regLists.saveError"),
        tone: "danger",
      });
    }
  };

  const colCount = 5; // trigger, name, steps, status, actions

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-bold text-foreground">{t("approvalRoutes.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("approvalRoutes.subtitle")}</p>
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <CardTitle>{t("approvalRoutes.title")}</CardTitle>
          {canAdd && usedTriggers.size < APPROVAL_TRIGGERS.length && (
            <Button
              size="sm"
              onClick={() => {
                setEditingHeader(null);
                setHeaderOpen(true);
              }}
            >
              <Plus weight="bold" />
              {t("regLists.new")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("approvalRoutes.col.trigger")}</TableHead>
                  <TableHead>{t("approvalRoutes.col.name")}</TableHead>
                  <TableHead>{t("approvalRoutes.col.steps")}</TableHead>
                  <TableHead>{t("regLists.col.status")}</TableHead>
                  <TableHead className="text-right">{t("regLists.col.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failed ? (
                  <TableEmpty colSpan={colCount}>{t("regLists.loadError")}</TableEmpty>
                ) : routes === null ? (
                  <TableEmpty colSpan={colCount}>{t("regLists.loading")}</TableEmpty>
                ) : routes.length === 0 ? (
                  <TableEmpty colSpan={colCount}>{t("regLists.empty")}</TableEmpty>
                ) : (
                  routes.map((row) => {
                    const steps = stepsByRoute[row.id] ?? [];
                    return (
                      <TableRow key={row.id}>
                        <TableCell>
                          <Badge tone="neutral">
                            {t(`enum.approvalTrigger.${row.trigger}` as MessageKey)}
                          </Badge>
                        </TableCell>
                        <TableCell>{bilingualName(row, locale)}</TableCell>
                        <TableCell>
                          {steps.length === 0 ? (
                            <span className="text-sm text-muted-foreground">
                              {t("approvalRoutes.stepsNone")}
                            </span>
                          ) : (
                            <div className="flex flex-wrap items-center gap-1.5">
                              {steps.map((s) => (
                                <span key={s.id} className="inline-flex items-center gap-1.5">
                                  <span className="text-xs text-muted-foreground">{s.stepNo}.</span>
                                  <Badge tone="info">
                                    {bilingualName(
                                      { nameId: s.roleNameId, nameEn: s.roleNameEn },
                                      locale,
                                    )}
                                  </Badge>
                                </span>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge tone={row.active ? "success" : "neutral"}>
                            {row.active
                              ? t("regLists.status.active")
                              : t("regLists.status.inactive")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {canEdit && (
                              <>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => {
                                    setStepsRoute(row);
                                    setStepsOpen(true);
                                  }}
                                >
                                  {t("approvalRoutes.editSteps")}
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => {
                                    setEditingHeader(row);
                                    setHeaderOpen(true);
                                  }}
                                >
                                  {t("regLists.edit")}
                                </Button>
                              </>
                            )}
                            {canDelete && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void toggleActive(row)}
                              >
                                {row.active ? t("regLists.deactivate") : t("regLists.reactivate")}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <HeaderDialog
        open={headerOpen}
        onOpenChange={setHeaderOpen}
        editing={editingHeader}
        usedTriggers={usedTriggers}
        onSaved={() => void load()}
      />
      <StepsDialog
        open={stepsOpen}
        onOpenChange={setStepsOpen}
        route={stepsRoute}
        roles={roles}
        initialSteps={stepsRoute ? (stepsByRoute[stepsRoute.id] ?? []) : []}
        onSaved={() => void load()}
      />
    </div>
  );
}
