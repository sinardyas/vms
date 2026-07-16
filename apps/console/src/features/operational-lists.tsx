import { Plus, Warning } from "@phosphor-icons/react";
import { DOC_APPLIES_TO, type Locale, type MessageKey, resolveLabel } from "@vms/domain";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useCan,
  useLocale,
  useT,
  useToast,
} from "@vms/ui";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  type DepartmentRow,
  type MasterRow,
  OperationalListApiError,
  type PortRow,
  type SlaThresholdRow,
  type SoechiEntityRow,
  type TaxCodeRow,
  type VesselRow,
  createItem,
  deactivateItem,
  listItems,
  reactivateItem,
  updateItem,
} from "../lib/operational-lists";
import { type CountryRow, listItems as listRegItems } from "../lib/registration-lists";

/**
 * Operational Lists (M2.5, #36) — the console screen for the six behaviorally-inert reference lists the
 * app manages but nothing in Phase-0 acts on (ADR-0002): departments, Soechi entities, vessels, ports,
 * tax codes, SLA thresholds. Each is the same M2.1 master CRUD surface (#32), so this is
 * **config-driven**: one generic tab + dialog rendered from a per-list {@link ListSpec}, not six
 * hand-written screens. Gated by the live capability grid (`useCan("operational_lists", …)`) — the same
 * module the routes enforce. SLA thresholds are shown with an explicit "inert config" note so no tester
 * mistakes them for a live SLA timer.
 */

// --- Spec model ----------------------------------------------------------------------------------

type FieldKind = "text" | "optionalText" | "boolean" | "country" | "appliesTo";

type FieldDef = {
  key: string;
  labelKey: MessageKey;
  kind: FieldKind;
  required?: boolean;
  /** Set on create, then fixed — like a role's `code`: shown disabled on edit, never in the patch. */
  createOnly?: boolean;
  default?: string | boolean;
};

type FormState = Record<string, string | boolean>;

type RenderCtx = {
  t: ReturnType<typeof useT>;
  locale: Locale;
  countryName: (id: string | null) => string;
};

type ColumnDef = { labelKey: MessageKey; render: (row: MasterRow, ctx: RenderCtx) => ReactNode };

type ListSpec = {
  key: string;
  /** API path segment under `/console/operational-lists`. */
  path: string;
  /** i18n key for the singular list name (tab label + dialog titles). */
  labelKey: MessageKey;
  fields: FieldDef[];
  columns: ColumnDef[];
  /** An optional bilingual note rendered above the table (e.g. SLA inertness). */
  noteKey?: MessageKey;
};

const bilingualPair = (idVal: string, enVal: string, locale: Locale): string =>
  resolveLabel({ id: idVal, en: enVal }, locale);

const dash = (v: string | null): ReactNode => v ?? "—";

const codeCell = (v: string): ReactNode => (
  <code className="text-xs text-muted-foreground">{v}</code>
);

// --- The six specs ---------------------------------------------------------------------------------

const departmentsSpec: ListSpec = {
  key: "departments",
  path: "departments",
  labelKey: "opsLists.tab.departments",
  fields: [
    { key: "code", labelKey: "regLists.f.code", kind: "text", required: true, createOnly: true },
    { key: "nameId", labelKey: "regLists.f.nameId", kind: "text", required: true },
    { key: "nameEn", labelKey: "regLists.f.nameEn", kind: "text", required: true },
  ],
  columns: [
    { labelKey: "regLists.f.code", render: (r) => codeCell((r as DepartmentRow).code) },
    {
      labelKey: "regLists.f.name",
      render: (r, c) =>
        bilingualPair((r as DepartmentRow).nameId, (r as DepartmentRow).nameEn, c.locale),
    },
  ],
};

const soechiEntitiesSpec: ListSpec = {
  key: "soechi-entities",
  path: "soechi-entities",
  labelKey: "opsLists.tab.soechiEntities",
  fields: [
    { key: "nameId", labelKey: "regLists.f.nameId", kind: "text", required: true },
    { key: "nameEn", labelKey: "regLists.f.nameEn", kind: "text", required: true },
  ],
  columns: [
    {
      labelKey: "regLists.f.name",
      render: (r, c) =>
        bilingualPair((r as SoechiEntityRow).nameId, (r as SoechiEntityRow).nameEn, c.locale),
    },
  ],
};

const vesselsSpec: ListSpec = {
  key: "vessels",
  path: "vessels",
  labelKey: "opsLists.tab.vessels",
  fields: [
    { key: "code", labelKey: "regLists.f.code", kind: "text", required: true, createOnly: true },
    { key: "name", labelKey: "regLists.f.name", kind: "text", required: true },
    { key: "type", labelKey: "opsLists.f.vesselType", kind: "optionalText" },
  ],
  columns: [
    { labelKey: "regLists.f.code", render: (r) => codeCell((r as VesselRow).code) },
    { labelKey: "regLists.f.name", render: (r) => (r as VesselRow).name },
    { labelKey: "opsLists.f.vesselType", render: (r) => dash((r as VesselRow).type) },
  ],
};

const portsSpec: ListSpec = {
  key: "ports",
  path: "ports",
  labelKey: "opsLists.tab.ports",
  fields: [
    { key: "code", labelKey: "regLists.f.code", kind: "text", required: true, createOnly: true },
    { key: "name", labelKey: "regLists.f.name", kind: "text", required: true },
    { key: "countryId", labelKey: "regLists.f.country", kind: "country" },
    { key: "tz", labelKey: "opsLists.f.tz", kind: "optionalText" },
    { key: "lat", labelKey: "opsLists.f.lat", kind: "optionalText" },
    { key: "lon", labelKey: "opsLists.f.lon", kind: "optionalText" },
  ],
  columns: [
    { labelKey: "regLists.f.code", render: (r) => codeCell((r as PortRow).code) },
    { labelKey: "regLists.f.name", render: (r) => (r as PortRow).name },
    { labelKey: "regLists.f.country", render: (r, c) => c.countryName((r as PortRow).countryId) },
    { labelKey: "opsLists.f.tz", render: (r) => dash((r as PortRow).tz) },
  ],
};

const taxCodesSpec: ListSpec = {
  key: "tax-codes",
  path: "tax-codes",
  labelKey: "opsLists.tab.taxCodes",
  fields: [
    { key: "code", labelKey: "regLists.f.code", kind: "text", required: true, createOnly: true },
    { key: "labelId", labelKey: "opsLists.f.labelId", kind: "text", required: true },
    { key: "labelEn", labelKey: "opsLists.f.labelEn", kind: "text", required: true },
    { key: "rate", labelKey: "opsLists.f.rate", kind: "optionalText" },
    { key: "basis", labelKey: "opsLists.f.basis", kind: "optionalText" },
    {
      key: "appliesTo",
      labelKey: "opsLists.f.appliesTo",
      kind: "appliesTo",
      required: true,
      default: "both",
    },
  ],
  columns: [
    { labelKey: "regLists.f.code", render: (r) => codeCell((r as TaxCodeRow).code) },
    {
      labelKey: "opsLists.f.label",
      render: (r, c) =>
        bilingualPair((r as TaxCodeRow).labelId, (r as TaxCodeRow).labelEn, c.locale),
    },
    { labelKey: "opsLists.f.rate", render: (r) => dash((r as TaxCodeRow).rate) },
    {
      labelKey: "opsLists.f.appliesTo",
      render: (r, c) => c.t(`enum.appliesTo.${(r as TaxCodeRow).appliesTo}` as MessageKey),
    },
  ],
};

const slaThresholdsSpec: ListSpec = {
  key: "sla-thresholds",
  path: "sla-thresholds",
  labelKey: "opsLists.tab.slaThresholds",
  noteKey: "opsLists.slaInert",
  fields: [
    { key: "stageId", labelKey: "opsLists.f.stageId", kind: "text", required: true },
    { key: "stageEn", labelKey: "opsLists.f.stageEn", kind: "text", required: true },
    { key: "target", labelKey: "opsLists.f.target", kind: "optionalText" },
    { key: "warnAt", labelKey: "opsLists.f.warnAt", kind: "optionalText" },
    { key: "email", labelKey: "opsLists.f.email", kind: "boolean", default: false },
  ],
  columns: [
    {
      labelKey: "opsLists.f.stage",
      render: (r, c) =>
        bilingualPair((r as SlaThresholdRow).stageId, (r as SlaThresholdRow).stageEn, c.locale),
    },
    { labelKey: "opsLists.f.target", render: (r) => dash((r as SlaThresholdRow).target) },
    { labelKey: "opsLists.f.warnAt", render: (r) => dash((r as SlaThresholdRow).warnAt) },
    {
      labelKey: "opsLists.f.email",
      render: (r) => (
        <Badge tone={(r as SlaThresholdRow).email ? "success" : "neutral"}>
          {(r as SlaThresholdRow).email ? "✓" : "—"}
        </Badge>
      ),
    },
  ],
};

const SPECS: readonly ListSpec[] = [
  departmentsSpec,
  soechiEntitiesSpec,
  vesselsSpec,
  portsSpec,
  taxCodesSpec,
  slaThresholdsSpec,
];

// --- Form helpers (generic over a spec's fields) -------------------------------------------------

const emptyForm = (fields: FieldDef[]): FormState => {
  const form: FormState = {};
  for (const fd of fields) form[fd.key] = fd.default ?? (fd.kind === "boolean" ? false : "");
  return form;
};

const rowToForm = (fields: FieldDef[], row: MasterRow): FormState => {
  const form: FormState = {};
  const bag = row as unknown as Record<string, unknown>;
  for (const fd of fields) {
    const v = bag[fd.key];
    form[fd.key] = fd.kind === "boolean" ? Boolean(v) : v == null ? "" : String(v);
  }
  return form;
};

/** Project the form back to the API body, dropping create-only keys on an edit. */
const formToPayload = (
  fields: FieldDef[],
  form: FormState,
  editing: boolean,
): Record<string, unknown> => {
  const body: Record<string, unknown> = {};
  for (const fd of fields) {
    if (editing && fd.createOnly) continue;
    const v = form[fd.key];
    if (fd.kind === "boolean") body[fd.key] = Boolean(v);
    else if (fd.kind === "optionalText") body[fd.key] = String(v).trim() ? String(v).trim() : null;
    else if (fd.kind === "country") body[fd.key] = v ? v : null;
    else body[fd.key] = String(v);
  }
  return body;
};

const requiredFilled = (fields: FieldDef[], form: FormState, editing: boolean): boolean =>
  fields.every((fd) => {
    if (editing && fd.createOnly) return true;
    if (!fd.required) return true;
    return String(form[fd.key]).trim().length > 0;
  });

const SELECT_CLASS =
  "h-11 w-full rounded-xl border border-input bg-card px-3.5 text-sm font-medium text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/30";

// --- Dialog --------------------------------------------------------------------------------------

function ListDialog({
  spec,
  open,
  onOpenChange,
  editing,
  countries,
  onSaved,
}: {
  spec: ListSpec;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: MasterRow | null;
  countries: CountryRow[];
  onSaved: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(() => emptyForm(spec.fields));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(editing ? rowToForm(spec.fields, editing) : emptyForm(spec.fields));
  }, [open, editing, spec]);

  const setField = (key: string, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const listName = t(spec.labelKey);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = formToPayload(spec.fields, form, !!editing);
      if (editing) await updateItem(spec.path, locale, editing.id, payload);
      else await createItem(spec.path, locale, payload);
      toast({ title: t("regLists.saved"), tone: "success" });
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setError(e instanceof OperationalListApiError ? e.message : t("regLists.saveError"));
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
          {spec.fields.map((fd) => {
            const disabled = !!editing && !!fd.createOnly;
            if (fd.kind === "boolean") {
              return (
                <label
                  key={fd.key}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={Boolean(form[fd.key])}
                    onChange={(e) => setField(fd.key, e.target.checked)}
                  />
                  <span className="text-sm font-medium text-foreground">{t(fd.labelKey)}</span>
                </label>
              );
            }
            if (fd.kind === "appliesTo") {
              return (
                <Field key={fd.key} label={t(fd.labelKey)} required={fd.required}>
                  {(p) => (
                    <select
                      {...p}
                      className={SELECT_CLASS}
                      value={String(form[fd.key])}
                      onChange={(e) => setField(fd.key, e.target.value)}
                    >
                      {DOC_APPLIES_TO.map((a) => (
                        <option key={a} value={a}>
                          {t(`enum.appliesTo.${a}` as MessageKey)}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              );
            }
            if (fd.kind === "country") {
              return (
                <Field key={fd.key} label={t(fd.labelKey)}>
                  {(p) => (
                    <select
                      {...p}
                      className={SELECT_CLASS}
                      value={String(form[fd.key])}
                      onChange={(e) => setField(fd.key, e.target.value)}
                    >
                      <option value="">{t("regLists.f.countryNone")}</option>
                      {countries.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} · {c.iso3}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              );
            }
            return (
              <Field key={fd.key} label={t(fd.labelKey)} required={fd.required && !disabled}>
                {(p) => (
                  <Input
                    {...p}
                    value={String(form[fd.key])}
                    disabled={disabled}
                    onChange={(e) => setField(fd.key, e.target.value)}
                  />
                )}
              </Field>
            );
          })}

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
          <Button
            onClick={() => void save()}
            disabled={saving || !requiredFilled(spec.fields, form, !!editing)}
          >
            {saving ? t("regLists.saving") : t("regLists.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- One list's tab ------------------------------------------------------------------------------

function MasterListTab({ spec, countries }: { spec: ListSpec; countries: CountryRow[] }) {
  const t = useT();
  const { locale } = useLocale();
  const { toast } = useToast();
  const canAdd = useCan("operational_lists", "add");
  const canEdit = useCan("operational_lists", "edit");
  const canDelete = useCan("operational_lists", "delete");

  const [rows, setRows] = useState<MasterRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MasterRow | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setRows(await listItems(spec.path, locale));
    } catch {
      setFailed(true);
    }
  }, [spec.path, locale]);
  useEffect(() => {
    void load();
  }, [load]);

  const countryName = useCallback(
    (id: string | null) => (id ? (countries.find((c) => c.id === id)?.name ?? "—") : "—"),
    [countries],
  );
  const ctx: RenderCtx = { t, locale, countryName };

  const toggleActive = async (row: MasterRow) => {
    try {
      if (row.active) await deactivateItem(spec.path, locale, row.id);
      else await reactivateItem(spec.path, locale, row.id);
      toast({ title: t("regLists.saved"), tone: "success" });
      await load();
    } catch (e) {
      toast({
        title: e instanceof OperationalListApiError ? e.message : t("regLists.saveError"),
        tone: "danger",
      });
    }
  };

  const colCount = spec.columns.length + 2; // + status + actions

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <CardTitle>{t(spec.labelKey)}</CardTitle>
        {canAdd && (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus weight="bold" />
            {t("regLists.new")}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {spec.noteKey && (
          <div className="mb-3 flex items-center gap-2 rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
            <Warning weight="fill" />
            {t(spec.noteKey)}
          </div>
        )}
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                {spec.columns.map((col) => (
                  <TableHead key={col.labelKey}>{t(col.labelKey)}</TableHead>
                ))}
                <TableHead>{t("regLists.col.status")}</TableHead>
                <TableHead className="text-right">{t("regLists.col.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failed ? (
                <TableEmpty colSpan={colCount}>{t("regLists.loadError")}</TableEmpty>
              ) : rows === null ? (
                <TableEmpty colSpan={colCount}>{t("regLists.loading")}</TableEmpty>
              ) : rows.length === 0 ? (
                <TableEmpty colSpan={colCount}>{t("regLists.empty")}</TableEmpty>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    {spec.columns.map((col) => (
                      <TableCell key={col.labelKey}>{col.render(row, ctx)}</TableCell>
                    ))}
                    <TableCell>
                      <Badge tone={row.active ? "success" : "neutral"}>
                        {row.active ? t("regLists.status.active") : t("regLists.status.inactive")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {canEdit && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setEditing(row);
                              setDialogOpen(true);
                            }}
                          >
                            {t("regLists.edit")}
                          </Button>
                        )}
                        {canDelete && (
                          <Button variant="ghost" size="sm" onClick={() => void toggleActive(row)}>
                            {row.active ? t("regLists.deactivate") : t("regLists.reactivate")}
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

      <ListDialog
        spec={spec}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        countries={countries}
        onSaved={() => void load()}
      />
    </Card>
  );
}

// --- Screen --------------------------------------------------------------------------------------

/**
 * The Operational Lists screen. Loads the countries list once (ports reference it for their country
 * picker + display). Countries live under `registration_lists`; a viewer without that grant just gets an
 * empty picker — the port's country is optional, so the tab still works (the same graceful degradation
 * the Master Data bank picker uses).
 */
export function OperationalLists() {
  const t = useT();
  const { locale } = useLocale();
  const [countries, setCountries] = useState<CountryRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    listRegItems<CountryRow>("countries", locale)
      .then((rows) => {
        if (!cancelled) setCountries(rows);
      })
      .catch(() => {
        // A failed countries load only degrades the port country picker; the tabs still render.
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-bold text-foreground">{t("opsLists.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("opsLists.subtitle")}</p>
      </div>

      <Tabs defaultValue={SPECS[0].key}>
        <TabsList>
          {SPECS.map((spec) => (
            <TabsTrigger key={spec.key} value={spec.key}>
              {t(spec.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>
        {SPECS.map((spec) => (
          <TabsContent key={spec.key} value={spec.key}>
            <MasterListTab spec={spec} countries={countries} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
