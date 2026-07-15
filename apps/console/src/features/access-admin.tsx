import { Plus, Warning } from "@phosphor-icons/react";
import {
  type MessageKey,
  RBAC_MODULES,
  RBAC_VERBS,
  type RbacModule,
  type RbacVerb,
} from "@vms/domain";
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
  DialogDescription,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useCan,
  useLocale,
  useT,
  useToast,
} from "@vms/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AccessApiError,
  type CriticalHolders,
  type MatrixGrid,
  type RoleDTO,
  type RolePayload,
  type UserDTO,
  createRole,
  createUser,
  deactivateRole,
  listEligibility,
  listRoles,
  listUsers,
  resetPassword,
  updateRole,
  updateUser,
} from "../lib/access";

/**
 * Access Control (M1.5, #24) — Users/Roles CRUD + the RBAC matrix editor, all built on `@vms/ui` and
 * gated by the live capability grid (`useCan("access", …)`) so an affordance is only shown when the
 * server would honour it. The distinctive piece is the **deadlock guard** (ADR-0011b): a save that
 * would strand the last holder of a required approval permission comes back as a warning the admin
 * can re-confirm — surfaced here as an inline banner + "Save anyway", never a silent commit.
 */

const emptyMatrix = (): MatrixGrid => {
  const grid = {} as MatrixGrid;
  for (const m of RBAC_MODULES) {
    const verbs = {} as Record<RbacVerb, boolean>;
    for (const v of RBAC_VERBS) verbs[v] = false;
    grid[m] = verbs;
  }
  return grid;
};

/** All keys are known-present in the catalogue, so the dynamic label lookup is a safe cast. */
const moduleLabel = (t: ReturnType<typeof useT>, m: RbacModule) =>
  t(`enum.rbacModule.${m}` as MessageKey);
const verbLabel = (t: ReturnType<typeof useT>, v: RbacVerb) =>
  t(`enum.rbacVerb.${v}` as MessageKey);
const roleName = (role: { nameId: string; nameEn: string }, locale: string) =>
  (locale === "en" ? role.nameEn : role.nameId) || role.nameEn || role.nameId;

// --- Matrix editor -------------------------------------------------------------------------------

function MatrixEditor({
  value,
  onChange,
  disabled,
}: {
  value: MatrixGrid;
  onChange: (next: MatrixGrid) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const toggle = (m: RbacModule, v: RbacVerb) =>
    onChange({ ...value, [m]: { ...value[m], [v]: !value[m][v] } });

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary/50">
            <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
              {t("access.roles.matrix.module")}
            </th>
            {RBAC_VERBS.map((v) => (
              <th key={v} className="px-2 py-2 text-center font-semibold text-muted-foreground">
                {verbLabel(t, v)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {RBAC_MODULES.map((m) => (
            <tr key={m} className="border-b border-border last:border-0">
              <td className="whitespace-nowrap px-3 py-1.5 font-medium text-foreground">
                {moduleLabel(t, m)}
              </td>
              {RBAC_VERBS.map((v) => (
                <td key={v} className="px-2 py-1.5 text-center">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-primary disabled:cursor-not-allowed"
                    checked={value[m][v]}
                    disabled={disabled}
                    onChange={() => toggle(m, v)}
                    aria-label={`${moduleLabel(t, m)} — ${verbLabel(t, v)}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Role dialog ---------------------------------------------------------------------------------

function RoleDialog({
  open,
  onOpenChange,
  editing,
  users,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: RoleDTO | null;
  users: UserDTO[];
  onSaved: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { toast } = useToast();

  const [code, setCode] = useState("");
  const [nameId, setNameId] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [leadUserId, setLeadUserId] = useState<string | null>(null);
  const [matrix, setMatrix] = useState<MatrixGrid>(emptyMatrix);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deadlock, setDeadlock] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDeadlock(null);
    setCode(editing?.code ?? "");
    setNameId(editing?.nameId ?? "");
    setNameEn(editing?.nameEn ?? "");
    setLeadUserId(editing?.leadUserId ?? null);
    setMatrix(editing?.matrix ?? emptyMatrix());
  }, [open, editing]);

  const save = async (confirm: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const base: RolePayload = { nameId, nameEn, leadUserId, matrix, confirm };
      if (editing) await updateRole(locale, editing.id, base);
      else await createRole(locale, { ...base, code });
      toast({ title: t("access.save"), tone: "success" });
      onOpenChange(false);
      onSaved();
    } catch (e) {
      if (e instanceof AccessApiError && e.isDeadlock) setDeadlock(e.message);
      else setError(e instanceof AccessApiError ? e.message : t("access.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const internalUsers = users.filter((u) => u.kind === "internal" && u.active);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? t("access.roles.editTitle") : t("access.roles.createTitle")}
          </DialogTitle>
          <DialogDescription>{t("access.roles.matrix")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {!editing && (
            <Field
              label={t("access.roles.field.code")}
              required
              helper={t("access.roles.field.code.helper")}
            >
              {(p) => (
                <Input
                  {...p}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="document_verifier"
                />
              )}
            </Field>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("access.roles.field.nameId")} required>
              {(p) => <Input {...p} value={nameId} onChange={(e) => setNameId(e.target.value)} />}
            </Field>
            <Field label={t("access.roles.field.nameEn")} required>
              {(p) => <Input {...p} value={nameEn} onChange={(e) => setNameEn(e.target.value)} />}
            </Field>
          </div>
          <Field label={t("access.roles.field.lead")}>
            {(p) => (
              <select
                {...p}
                className="h-11 w-full rounded-xl border border-input bg-card px-3.5 text-sm font-medium text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/30"
                value={leadUserId ?? ""}
                onChange={(e) => setLeadUserId(e.target.value || null)}
              >
                <option value="">{t("access.roles.field.lead.none")}</option>
                {internalUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {u.email}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {t("access.roles.matrix")}
            </span>
            <MatrixEditor value={matrix} onChange={setMatrix} disabled={saving} />
          </div>

          {deadlock && (
            <div className="flex items-start gap-2 rounded-xl bg-warning/10 p-3 text-sm text-warning-foreground">
              <Warning weight="fill" className="mt-0.5 shrink-0 text-warning" />
              <span>{deadlock}</span>
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
            {t("access.cancel")}
          </Button>
          {deadlock ? (
            <Button variant="destructive" onClick={() => save(true)} disabled={saving}>
              {t("access.deadlock.confirm")}
            </Button>
          ) : (
            <Button
              onClick={() => save(false)}
              disabled={saving || !nameId.trim() || !nameEn.trim() || (!editing && !code.trim())}
            >
              {saving ? t("access.saving") : t("access.save")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- User dialog ---------------------------------------------------------------------------------

function UserDialog({
  open,
  onOpenChange,
  editing,
  roles,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: UserDTO | null;
  roles: RoleDTO[];
  onSaved: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deadlock, setDeadlock] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDeadlock(null);
    setEmail(editing?.email ?? "");
    setName(editing?.name ?? "");
    setRoleIds(editing?.roles.map((r) => r.id) ?? []);
  }, [open, editing]);

  const toggleRole = (id: string) =>
    setRoleIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));

  const save = async (confirm: boolean) => {
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await updateUser(locale, editing.id, { name, roleIds, confirm });
        toast({ title: t("access.save"), tone: "success" });
      } else {
        const created = await createUser(locale, { email, name, roleIds });
        toast({ title: t("access.users.created", { email: created.email }), tone: "success" });
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      if (e instanceof AccessApiError && e.isDeadlock) setDeadlock(e.message);
      else setError(e instanceof AccessApiError ? e.message : t("access.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? t("access.users.editTitle") : t("access.users.createTitle")}
          </DialogTitle>
          {!editing && <DialogDescription>{t("access.users.createHint")}</DialogDescription>}
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field label={t("access.users.field.email")} required>
            {(p) => (
              <Input
                {...p}
                type="email"
                value={email}
                disabled={!!editing}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Field label={t("access.users.field.name")} required>
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {t("access.users.field.roles")}
            </span>
            <div className="flex max-h-44 flex-col gap-1 overflow-y-auto rounded-xl border border-border p-2">
              {roles
                .filter((r) => r.active)
                .map((r) => (
                  <label
                    key={r.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-secondary"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={roleIds.includes(r.id)}
                      onChange={() => toggleRole(r.id)}
                    />
                    <span className="text-sm font-medium text-foreground">
                      {roleName(r, locale)}
                    </span>
                    <code className="ml-auto rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                      {r.code}
                    </code>
                  </label>
                ))}
            </div>
          </div>

          {deadlock && (
            <div className="flex items-start gap-2 rounded-xl bg-warning/10 p-3 text-sm text-warning-foreground">
              <Warning weight="fill" className="mt-0.5 shrink-0 text-warning" />
              <span>{deadlock}</span>
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
            {t("access.cancel")}
          </Button>
          {deadlock ? (
            <Button variant="destructive" onClick={() => save(true)} disabled={saving}>
              {t("access.deadlock.confirm")}
            </Button>
          ) : (
            <Button
              onClick={() => save(false)}
              disabled={saving || !name.trim() || (!editing && !email.trim())}
            >
              {saving ? t("access.saving") : t("access.save")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Roles tab -----------------------------------------------------------------------------------

function RolesTab({ users, onMutated }: { users: UserDTO[]; onMutated: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const { toast } = useToast();
  const canAdd = useCan("access", "add");
  const canEdit = useCan("access", "edit");
  const canDelete = useCan("access", "delete");

  const [roles, setRoles] = useState<RoleDTO[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RoleDTO | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setRoles(await listRoles(locale));
    } catch {
      setFailed(true);
    }
  }, [locale]);
  useEffect(() => {
    void load();
  }, [load]);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const toggleActive = async (role: RoleDTO) => {
    try {
      if (role.active) await deactivateRole(locale, role.id);
      else await updateRole(locale, role.id, { active: true });
      toast({ title: t("access.save"), tone: "success" });
      await load();
    } catch (e) {
      toast({
        title: e instanceof AccessApiError ? e.message : t("access.saveError"),
        tone: e instanceof AccessApiError && e.isDeadlock ? "warning" : "danger",
      });
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{t("access.tab.roles")}</CardTitle>
          <CardDescription>{t("access.subtitle")}</CardDescription>
        </div>
        {canAdd && (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus weight="bold" />
            {t("access.roles.new")}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("access.roles.col.role")}</TableHead>
                <TableHead>{t("access.roles.col.lead")}</TableHead>
                <TableHead>{t("access.roles.col.users")}</TableHead>
                <TableHead>{t("access.roles.col.status")}</TableHead>
                <TableHead className="text-right">{t("access.roles.col.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failed ? (
                <TableEmpty colSpan={5}>{t("access.loadError")}</TableEmpty>
              ) : roles === null ? (
                <TableEmpty colSpan={5}>{t("access.loading")}</TableEmpty>
              ) : roles.length === 0 ? (
                <TableEmpty colSpan={5}>{t("access.roles.empty")}</TableEmpty>
              ) : (
                roles.map((role) => (
                  <TableRow key={role.id}>
                    <TableCell>
                      <div className="font-semibold text-foreground">{roleName(role, locale)}</div>
                      <code className="text-xs text-muted-foreground">{role.code}</code>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {role.leadUserId ? (usersById.get(role.leadUserId)?.name ?? "—") : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{role.userCount}</TableCell>
                    <TableCell>
                      <Badge tone={role.active ? "success" : "neutral"}>
                        {role.active ? t("access.status.active") : t("access.status.inactive")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {canEdit && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setEditing(role);
                              setDialogOpen(true);
                            }}
                          >
                            {t("access.roles.edit")}
                          </Button>
                        )}
                        {canDelete && (
                          <Button variant="ghost" size="sm" onClick={() => void toggleActive(role)}>
                            {role.active
                              ? t("access.roles.deactivate")
                              : t("access.roles.reactivate")}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>

      <RoleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        users={users}
        onSaved={() => {
          void load();
          onMutated();
        }}
      />
    </Card>
  );
}

// --- Users tab -----------------------------------------------------------------------------------

function UsersTab({ roles, onMutated }: { roles: RoleDTO[]; onMutated: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const { toast } = useToast();
  const canAdd = useCan("access", "add");
  const canEdit = useCan("access", "edit");

  const [users, setUsers] = useState<UserDTO[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UserDTO | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setUsers(await listUsers(locale));
    } catch {
      setFailed(true);
    }
  }, [locale]);
  useEffect(() => {
    void load();
  }, [load]);

  const doReset = async (user: UserDTO) => {
    try {
      await resetPassword(locale, user.id);
      toast({ title: t("access.users.resetSent", { email: user.email }), tone: "success" });
    } catch (e) {
      toast({
        title: e instanceof AccessApiError ? e.message : t("access.saveError"),
        tone: "danger",
      });
    }
  };

  const toggleActive = async (user: UserDTO) => {
    try {
      await updateUser(locale, user.id, { active: !user.active });
      toast({ title: t("access.save"), tone: "success" });
      await load();
    } catch (e) {
      toast({
        title: e instanceof AccessApiError ? e.message : t("access.saveError"),
        tone: e instanceof AccessApiError && e.isDeadlock ? "warning" : "danger",
      });
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{t("access.tab.users")}</CardTitle>
          <CardDescription>{t("access.subtitle")}</CardDescription>
        </div>
        {canAdd && (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus weight="bold" />
            {t("access.users.new")}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("access.users.col.name")}</TableHead>
                <TableHead>{t("access.users.col.email")}</TableHead>
                <TableHead>{t("access.users.col.kind")}</TableHead>
                <TableHead>{t("access.users.col.roles")}</TableHead>
                <TableHead>{t("access.users.col.status")}</TableHead>
                <TableHead className="text-right">{t("access.users.col.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failed ? (
                <TableEmpty colSpan={6}>{t("access.loadError")}</TableEmpty>
              ) : users === null ? (
                <TableEmpty colSpan={6}>{t("access.loading")}</TableEmpty>
              ) : users.length === 0 ? (
                <TableEmpty colSpan={6}>{t("access.users.empty")}</TableEmpty>
              ) : (
                users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-semibold text-foreground">{user.name}</TableCell>
                    <TableCell className="text-muted-foreground">{user.email}</TableCell>
                    <TableCell>
                      <Badge tone={user.kind === "internal" ? "navy" : "neutral"}>
                        {user.kind === "internal"
                          ? t("access.kind.internal")
                          : t("access.kind.vendor")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {user.roles.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          user.roles.map((r) => (
                            <Badge key={r.id} tone="primary">
                              {roleName(r, locale)}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge tone={user.active ? "success" : "neutral"}>
                        {user.active ? t("access.status.active") : t("access.status.inactive")}
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
                                setEditing(user);
                                setDialogOpen(true);
                              }}
                            >
                              {t("access.users.edit")}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => void doReset(user)}>
                              {t("access.users.resetPassword")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void toggleActive(user)}
                            >
                              {user.active
                                ? t("access.users.deactivate")
                                : t("access.users.reactivate")}
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>

      <UserDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        roles={roles}
        onSaved={() => {
          void load();
          onMutated();
        }}
      />
    </Card>
  );
}

// --- Screen --------------------------------------------------------------------------------------

/**
 * The Access Control screen. Loads the shared reference data (roles + users, used to cross-populate
 * the lead picker and the role assignment lists) once at the top and re-loads on any mutation, and
 * shows the current critical-capability holder counts so the deadlock guard's context is visible
 * before a save trips it.
 */
export function AccessAdmin() {
  const t = useT();
  const { locale } = useLocale();
  const [roles, setRoles] = useState<RoleDTO[]>([]);
  const [users, setUsers] = useState<UserDTO[]>([]);
  const [eligibility, setEligibility] = useState<CriticalHolders[]>([]);

  const loadShared = useCallback(async () => {
    const [r, u, e] = await Promise.allSettled([
      listRoles(locale),
      listUsers(locale),
      listEligibility(locale),
    ]);
    if (r.status === "fulfilled") setRoles(r.value);
    if (u.status === "fulfilled") setUsers(u.value);
    if (e.status === "fulfilled") setEligibility(e.value);
  }, [locale]);

  useEffect(() => {
    void loadShared();
  }, [loadShared]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-bold text-foreground">{t("access.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("access.subtitle")}</p>
      </div>

      {eligibility.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {eligibility.map((cap) => (
            <Badge key={`${cap.module}:${cap.verb}`} tone={cap.holders === 0 ? "warning" : "info"}>
              {moduleLabel(t, cap.module)} · {verbLabel(t, cap.verb)} —{" "}
              {t("access.eligibility.holders", { count: cap.holders })}
            </Badge>
          ))}
        </div>
      )}

      <Tabs defaultValue="roles">
        <TabsList>
          <TabsTrigger value="roles">{t("access.tab.roles")}</TabsTrigger>
          <TabsTrigger value="users">{t("access.tab.users")}</TabsTrigger>
        </TabsList>
        <TabsContent value="roles">
          <RolesTab users={users} onMutated={loadShared} />
        </TabsContent>
        <TabsContent value="users">
          <UsersTab roles={roles} onMutated={loadShared} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
