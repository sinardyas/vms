import { Plus, Warning } from "@phosphor-icons/react";
import { LOCALITIES, type Locale, type MessageKey, resolveLabel } from "@vms/domain";
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
  type BankRow,
  type BusinessEntityRow,
  type CountryRow,
  type CurrencyRow,
  type MasterRow,
  RegistrationListApiError,
  type VendorCategoryRow,
  createItem,
  deactivateItem,
  listItems,
  reactivateItem,
  updateItem,
} from "../lib/registration-lists";

/**
 * Master Data (M2.2, #33) — the console screen for the five registration lists vendor registration
 * reads (business entities, vendor categories, banks, currencies, countries). Each is the same M2.1
 * master CRUD surface (#32), so this is **config-driven**: one generic tab + dialog rendered from a
 * per-list {@link ListSpec} (its fields + columns), not five hand-written screens. Gated by the live
 * capability grid (`useCan("registration_lists", …)`) — the same module the routes enforce — and it
 * honours the framework's deactivate rule: deactivating a row hides it from new captures (the `?active`
 * read) but the row stays, so existing vendor references keep resolving.
 */

// --- Spec model ----------------------------------------------------------------------------------

type FieldKind = "text" | "optionalText" | "locality" | "boolean" | "country";

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
  /** API path segment under `/console/registration-lists`. */
  path: string;
  /** i18n key for the singular list name (tab label + dialog titles). */
  labelKey: MessageKey;
  fields: FieldDef[];
  columns: ColumnDef[];
};

const bilingual = (row: { nameId: string; nameEn: string }, locale: Locale): string =>
  resolveLabel({ id: row.nameId, en: row.nameEn }, locale);

const localityLabel = (t: ReturnType<typeof useT>, value: string): string =>
  t(`enum.locality.${value}` as MessageKey);

// --- The five specs --------------------------------------------------------------------------------

const businessEntitiesSpec: ListSpec = {
  key: "business-entities",
  path: "business-entities",
  labelKey: "regLists.tab.businessEntities",
  fields: [
    { key: "nameId", labelKey: "regLists.f.nameId", kind: "text", required: true },
    { key: "nameEn", labelKey: "regLists.f.nameEn", kind: "text", required: true },
    {
      key: "category",
      labelKey: "regLists.f.category",
      kind: "locality",
      required: true,
      default: "local",
    },
  ],
  columns: [
    { labelKey: "regLists.f.name", render: (r, c) => bilingual(r as BusinessEntityRow, c.locale) },
    {
      labelKey: "regLists.f.category",
      render: (r, c) => localityLabel(c.t, (r as BusinessEntityRow).category),
    },
  ],
};

const vendorCategoriesSpec: ListSpec = {
  key: "vendor-categories",
  path: "vendor-categories",
  labelKey: "regLists.tab.vendorCategories",
  fields: [
    { key: "nameId", labelKey: "regLists.f.nameId", kind: "text", required: true },
    { key: "nameEn", labelKey: "regLists.f.nameEn", kind: "text", required: true },
  ],
  columns: [
    { labelKey: "regLists.f.name", render: (r, c) => bilingual(r as VendorCategoryRow, c.locale) },
  ],
};

const banksSpec: ListSpec = {
  key: "banks",
  path: "banks",
  labelKey: "regLists.tab.banks",
  fields: [
    { key: "name", labelKey: "regLists.f.name", kind: "text", required: true },
    { key: "code", labelKey: "regLists.f.code", kind: "text", required: true, createOnly: true },
    {
      key: "location",
      labelKey: "regLists.f.location",
      kind: "locality",
      required: true,
      default: "local",
    },
    { key: "countryId", labelKey: "regLists.f.country", kind: "country" },
  ],
  columns: [
    { labelKey: "regLists.f.name", render: (r) => (r as BankRow).name },
    {
      labelKey: "regLists.f.code",
      render: (r) => <code className="text-xs text-muted-foreground">{(r as BankRow).code}</code>,
    },
    {
      labelKey: "regLists.f.location",
      render: (r, c) => localityLabel(c.t, (r as BankRow).location),
    },
    { labelKey: "regLists.f.country", render: (r, c) => c.countryName((r as BankRow).countryId) },
  ],
};

const currenciesSpec: ListSpec = {
  key: "currencies",
  path: "currencies",
  labelKey: "regLists.tab.currencies",
  fields: [
    { key: "code", labelKey: "regLists.f.code", kind: "text", required: true, createOnly: true },
    { key: "name", labelKey: "regLists.f.name", kind: "text", required: true },
    { key: "country", labelKey: "regLists.f.country", kind: "optionalText" },
    {
      key: "showInBankSelector",
      labelKey: "regLists.f.showInBankSelector",
      kind: "boolean",
      default: true,
    },
  ],
  columns: [
    {
      labelKey: "regLists.f.code",
      render: (r) => (
        <code className="text-xs font-semibold text-foreground">{(r as CurrencyRow).code}</code>
      ),
    },
    { labelKey: "regLists.f.name", render: (r) => (r as CurrencyRow).name },
    { labelKey: "regLists.f.country", render: (r) => (r as CurrencyRow).country ?? "—" },
    {
      labelKey: "regLists.f.showInBankSelector",
      render: (r) => (
        <Badge tone={(r as CurrencyRow).showInBankSelector ? "success" : "neutral"}>
          {(r as CurrencyRow).showInBankSelector ? "✓" : "—"}
        </Badge>
      ),
    },
  ],
};

const countriesSpec: ListSpec = {
  key: "countries",
  path: "countries",
  labelKey: "regLists.tab.countries",
  fields: [
    { key: "name", labelKey: "regLists.f.name", kind: "text", required: true },
    { key: "iso3", labelKey: "regLists.f.iso3", kind: "text", required: true, createOnly: true },
  ],
  columns: [
    { labelKey: "regLists.f.name", render: (r) => (r as CountryRow).name },
    {
      labelKey: "regLists.f.iso3",
      render: (r) => (
        <code className="text-xs text-muted-foreground">{(r as CountryRow).iso3}</code>
      ),
    },
  ],
};

const SPECS: readonly ListSpec[] = [
  businessEntitiesSpec,
  vendorCategoriesSpec,
  banksSpec,
  currenciesSpec,
  countriesSpec,
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
      setError(e instanceof RegistrationListApiError ? e.message : t("regLists.saveError"));
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
            if (fd.kind === "locality") {
              return (
                <Field key={fd.key} label={t(fd.labelKey)} required={fd.required}>
                  {(p) => (
                    <select
                      {...p}
                      className={SELECT_CLASS}
                      value={String(form[fd.key])}
                      onChange={(e) => setField(fd.key, e.target.value)}
                    >
                      {LOCALITIES.map((l) => (
                        <option key={l} value={l}>
                          {localityLabel(t, l)}
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

function MasterListTab({
  spec,
  countries,
  onCountriesChanged,
}: {
  spec: ListSpec;
  countries: CountryRow[];
  onCountriesChanged: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { toast } = useToast();
  const canAdd = useCan("registration_lists", "add");
  const canEdit = useCan("registration_lists", "edit");
  const canDelete = useCan("registration_lists", "delete");

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

  const afterMutation = async () => {
    await load();
    if (spec.path === "countries") onCountriesChanged();
  };

  const toggleActive = async (row: MasterRow) => {
    try {
      if (row.active) await deactivateItem(spec.path, locale, row.id);
      else await reactivateItem(spec.path, locale, row.id);
      toast({ title: t("regLists.saved"), tone: "success" });
      await afterMutation();
    } catch (e) {
      toast({
        title: e instanceof RegistrationListApiError ? e.message : t("regLists.saveError"),
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
        onSaved={() => void afterMutation()}
      />
    </Card>
  );
}

// --- Screen --------------------------------------------------------------------------------------

/**
 * The Master Data screen. Loads the countries list once at the top (banks reference it for their
 * country picker + display) and re-loads it whenever the Countries tab mutates, so a country added in
 * one tab is immediately selectable in the Banks tab.
 */
export function RegistrationLists() {
  const t = useT();
  const { locale } = useLocale();
  const [countries, setCountries] = useState<CountryRow[]>([]);

  const loadCountries = useCallback(async () => {
    try {
      setCountries(await listItems<CountryRow>("countries", locale));
    } catch {
      // A failed countries load only degrades the bank country picker; the tabs still render.
    }
  }, [locale]);
  useEffect(() => {
    void loadCountries();
  }, [loadCountries]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-bold text-foreground">{t("regLists.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("regLists.subtitle")}</p>
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
            <MasterListTab spec={spec} countries={countries} onCountriesChanged={loadCountries} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
