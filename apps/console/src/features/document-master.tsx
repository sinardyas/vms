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
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DocMasterApiError,
  type DocumentRow,
  type RequirementRow,
  clearRequirement,
  createDocument,
  deactivateDocument,
  listDocuments,
  listRequirements,
  reactivateDocument,
  setRequirement,
  updateDocument,
} from "../lib/document-master";
import { type VendorCategoryRow, listItems } from "../lib/registration-lists";

/**
 * Document Master (M2.3, #34, ADR-0013) — the console screen for the compliance document types
 * requested from vendors plus the category→document requirements matrix the M5.2 activation gate
 * reads. Two tabs, both gated on `document_master` (`useCan(...)`, the same module the routes enforce):
 *
 *   - **Documents** — the M2.1 master CRUD surface (#32) over `document_master`: bilingual name, origin
 *     `applies_to`, `mandatory`, validity, reminder; deactivating a doc hides it from new captures (its
 *     `enabled` flag) while existing references keep resolving.
 *   - **Category Requirements** — the bespoke M:N matrix editor: rows = documents, columns = active
 *     vendor categories, each cell cycling Not-required → Mandatory → Optional and persisting via the
 *     `/requirements` verbs. This is the gate input made editable end-to-end.
 */

const SELECT_CLASS =
  "h-11 w-full rounded-xl border border-input bg-card px-3.5 text-sm font-medium text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/30";

const bilingualName = (row: { nameId: string; nameEn: string }, locale: Locale): string =>
  resolveLabel({ id: row.nameId, en: row.nameEn }, locale);

// --- Documents tab: form model ------------------------------------------------------------------

type DocForm = {
  no: string;
  nameId: string;
  nameEn: string;
  type: string;
  appliesTo: string;
  validityDays: string;
  mandatory: boolean;
  reminder: string;
};

const emptyDocForm = (): DocForm => ({
  no: "",
  nameId: "",
  nameEn: "",
  type: "",
  appliesTo: "both",
  validityDays: "0",
  mandatory: false,
  reminder: "Off",
});

const rowToForm = (row: DocumentRow): DocForm => ({
  no: row.no,
  nameId: row.nameId,
  nameEn: row.nameEn,
  type: row.type,
  appliesTo: row.appliesTo,
  validityDays: String(row.validityDays),
  mandatory: row.mandatory,
  reminder: row.reminder,
});

/** Project the form to the API body; drop the create-only `no` on an edit (it can't collide). */
const formToPayload = (form: DocForm, editing: boolean): Record<string, unknown> => {
  const validityDays = Number.parseInt(form.validityDays, 10);
  const body: Record<string, unknown> = {
    nameId: form.nameId.trim(),
    nameEn: form.nameEn.trim(),
    type: form.type.trim(),
    appliesTo: form.appliesTo,
    validityDays: Number.isFinite(validityDays) && validityDays >= 0 ? validityDays : 0,
    mandatory: form.mandatory,
    reminder: form.reminder.trim() || "Off",
  };
  if (!editing) body.no = form.no.trim();
  return body;
};

const docFormValid = (form: DocForm, editing: boolean): boolean => {
  const validityDays = Number.parseInt(form.validityDays, 10);
  return (
    (editing || form.no.trim().length > 0) &&
    form.nameId.trim().length > 0 &&
    form.nameEn.trim().length > 0 &&
    form.type.trim().length > 0 &&
    Number.isFinite(validityDays) &&
    validityDays >= 0
  );
};

// --- Documents tab: dialog ----------------------------------------------------------------------

function DocumentDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: DocumentRow | null;
  onSaved: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { toast } = useToast();
  const [form, setForm] = useState<DocForm>(emptyDocForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(editing ? rowToForm(editing) : emptyDocForm());
  }, [open, editing]);

  const set = <K extends keyof DocForm>(key: K, value: DocForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const listName = t("docMaster.doc");

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = formToPayload(form, !!editing);
      if (editing) await updateDocument(locale, editing.id, payload);
      else await createDocument(locale, payload);
      toast({ title: t("regLists.saved"), tone: "success" });
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setError(e instanceof DocMasterApiError ? e.message : t("regLists.saveError"));
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
          <Field label={t("docMaster.f.no")} required={!editing}>
            {(p) => (
              <Input
                {...p}
                value={form.no}
                disabled={!!editing}
                placeholder="DOC-021"
                onChange={(e) => set("no", e.target.value)}
              />
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
          <Field label={t("docMaster.f.type")} required>
            {(p) => (
              <Input
                {...p}
                value={form.type}
                placeholder={t("docMaster.f.typePlaceholder")}
                onChange={(e) => set("type", e.target.value)}
              />
            )}
          </Field>
          <Field label={t("docMaster.f.appliesTo")} required>
            {(p) => (
              <select
                {...p}
                className={SELECT_CLASS}
                value={form.appliesTo}
                onChange={(e) => set("appliesTo", e.target.value)}
              >
                {DOC_APPLIES_TO.map((a) => (
                  <option key={a} value={a}>
                    {t(`enum.appliesTo.${a}` as MessageKey)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t("docMaster.f.validityDays")} required>
            {(p) => (
              <Input
                {...p}
                type="number"
                min={0}
                value={form.validityDays}
                onChange={(e) => set("validityDays", e.target.value)}
              />
            )}
          </Field>
          <Field label={t("docMaster.f.reminder")}>
            {(p) => (
              <Input
                {...p}
                value={form.reminder}
                placeholder={t("docMaster.f.reminderPlaceholder")}
                onChange={(e) => set("reminder", e.target.value)}
              />
            )}
          </Field>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={form.mandatory}
              onChange={(e) => set("mandatory", e.target.checked)}
            />
            <span className="text-sm font-medium text-foreground">
              {t("docMaster.f.mandatory")}
            </span>
          </label>

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
          <Button onClick={() => void save()} disabled={saving || !docFormValid(form, !!editing)}>
            {saving ? t("regLists.saving") : t("regLists.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Documents tab ------------------------------------------------------------------------------

function DocumentsTab({ onDocsChanged }: { onDocsChanged: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const { toast } = useToast();
  const canAdd = useCan("document_master", "add");
  const canEdit = useCan("document_master", "edit");
  const canDelete = useCan("document_master", "delete");

  const [rows, setRows] = useState<DocumentRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DocumentRow | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setRows(await listDocuments(locale));
    } catch {
      setFailed(true);
    }
  }, [locale]);
  useEffect(() => {
    void load();
  }, [load]);

  const afterMutation = async () => {
    await load();
    onDocsChanged();
  };

  const toggleActive = async (row: DocumentRow) => {
    try {
      if (row.active) await deactivateDocument(locale, row.id);
      else await reactivateDocument(locale, row.id);
      toast({ title: t("regLists.saved"), tone: "success" });
      await afterMutation();
    } catch (e) {
      toast({
        title: e instanceof DocMasterApiError ? e.message : t("regLists.saveError"),
        tone: "danger",
      });
    }
  };

  const colCount = 7; // no, name, type, appliesTo, validity+mandatory, status, actions

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <CardTitle>{t("docMaster.tab.documents")}</CardTitle>
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
                <TableHead>{t("docMaster.f.no")}</TableHead>
                <TableHead>{t("docMaster.f.name")}</TableHead>
                <TableHead>{t("docMaster.f.type")}</TableHead>
                <TableHead>{t("docMaster.f.appliesTo")}</TableHead>
                <TableHead>{t("docMaster.f.validityDays")}</TableHead>
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
                    <TableCell>
                      <code className="text-xs text-muted-foreground">{row.no}</code>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {bilingualName(row, locale)}
                        {/* Both cases carry a badge (#90): mandatory-only meant "optional" read as
                            an absence, which is indistinguishable from a rendering bug. */}
                        {row.mandatory ? (
                          <Badge tone="warning">{t("docMaster.badge.mandatory")}</Badge>
                        ) : (
                          <Badge tone="neutral">{t("docMaster.badge.optional")}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{row.type}</TableCell>
                    <TableCell>
                      <Badge tone="neutral">
                        {t(`enum.appliesTo.${row.appliesTo}` as MessageKey)}
                      </Badge>
                    </TableCell>
                    <TableCell>{row.validityDays > 0 ? row.validityDays : "—"}</TableCell>
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

      <DocumentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={() => void afterMutation()}
      />
    </Card>
  );
}

// --- Category-requirements matrix tab -----------------------------------------------------------

/** A cell's three states: not required, required-optional, required-mandatory (ADR-0013). */
type CellState = "none" | "optional" | "mandatory";

const cellKey = (docId: string, categoryId: string): string => `${docId}:${categoryId}`;

function RequirementsTab() {
  const t = useT();
  const { locale } = useLocale();
  const { toast } = useToast();
  const canEdit = useCan("document_master", "edit");

  const [documents, setDocuments] = useState<DocumentRow[] | null>(null);
  const [categories, setCategories] = useState<VendorCategoryRow[]>([]);
  const [requirements, setRequirements] = useState<RequirementRow[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [docs, cats, reqs] = await Promise.all([
        listDocuments(locale),
        listItems<VendorCategoryRow>("vendor-categories", locale, true),
        listRequirements(locale),
      ]);
      setDocuments(docs);
      setCategories(cats);
      setRequirements(reqs);
    } catch {
      setFailed(true);
    }
  }, [locale]);
  useEffect(() => {
    void load();
  }, [load]);

  // Cell state lookup keyed by doc:category — mandatory row → "mandatory", active non-mandatory →
  // "optional", absent → "none".
  const stateByCell = useMemo(() => {
    const map = new Map<string, CellState>();
    for (const r of requirements)
      map.set(cellKey(r.documentMasterId, r.categoryId), r.mandatory ? "mandatory" : "optional");
    return map;
  }, [requirements]);

  const cellLabel: Record<CellState, string> = {
    none: t("docMaster.matrix.cell.none"),
    mandatory: t("docMaster.matrix.cell.mandatory"),
    optional: t("docMaster.matrix.cell.optional"),
  };
  const cellTone: Record<CellState, "neutral" | "warning" | "success"> = {
    none: "neutral",
    mandatory: "warning",
    optional: "success",
  };

  // Cycle none → mandatory → optional → none, persisting each transition.
  const cycle = async (doc: DocumentRow, category: VendorCategoryRow) => {
    if (!canEdit) return;
    const key = cellKey(doc.id, category.id);
    const current = stateByCell.get(key) ?? "none";
    const next: CellState =
      current === "none" ? "mandatory" : current === "mandatory" ? "optional" : "none";
    setBusy(key);
    try {
      if (next === "none") await clearRequirement(locale, category.id, doc.id);
      else await setRequirement(locale, category.id, doc.id, next === "mandatory");
      await load();
    } catch (e) {
      toast({
        title: e instanceof DocMasterApiError ? e.message : t("regLists.saveError"),
        tone: "danger",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("docMaster.matrix.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("docMaster.matrix.subtitle")}</p>
        <div className="flex flex-wrap gap-3 pt-1 text-xs text-muted-foreground">
          <span>{t("docMaster.matrix.legend.mandatory")}</span>
          <span>{t("docMaster.matrix.legend.optional")}</span>
          <span>{t("docMaster.matrix.legend.none")}</span>
        </div>
      </CardHeader>
      <CardContent>
        {failed ? (
          <p className="text-sm text-destructive">{t("regLists.loadError")}</p>
        ) : documents === null ? (
          <p className="text-sm text-muted-foreground">{t("regLists.loading")}</p>
        ) : documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("docMaster.matrix.noDocuments")}</p>
        ) : categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("docMaster.matrix.noCategories")}</p>
        ) : (
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-10 bg-card">
                    {t("docMaster.matrix.docColumn")}
                  </TableHead>
                  {categories.map((cat) => (
                    <TableHead key={cat.id} className="whitespace-nowrap text-center">
                      {bilingualName(cat, locale)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="sticky left-0 z-10 whitespace-nowrap bg-card">
                      <code className="mr-2 text-xs text-muted-foreground">{doc.no}</code>
                      {bilingualName(doc, locale)}
                    </TableCell>
                    {categories.map((cat) => {
                      const key = cellKey(doc.id, cat.id);
                      const state = stateByCell.get(key) ?? "none";
                      return (
                        <TableCell key={cat.id} className="text-center">
                          <button
                            type="button"
                            disabled={!canEdit || busy === key}
                            onClick={() => void cycle(doc, cat)}
                            className="inline-flex items-center justify-center disabled:opacity-50"
                            aria-label={`${doc.no} × ${bilingualName(cat, locale)}`}
                          >
                            <Badge tone={cellTone[state]}>{cellLabel[state]}</Badge>
                          </button>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
}

// --- Screen -------------------------------------------------------------------------------------

export function DocumentMaster() {
  const t = useT();
  // Bump to re-load the matrix when a document is added/edited/toggled in the Documents tab.
  const [docsVersion, setDocsVersion] = useState(0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-bold text-foreground">{t("docMaster.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("docMaster.subtitle")}</p>
      </div>

      <Tabs defaultValue="documents">
        <TabsList>
          <TabsTrigger value="documents">{t("docMaster.tab.documents")}</TabsTrigger>
          <TabsTrigger value="requirements">{t("docMaster.tab.requirements")}</TabsTrigger>
        </TabsList>
        <TabsContent value="documents">
          <DocumentsTab onDocsChanged={() => setDocsVersion((v) => v + 1)} />
        </TabsContent>
        <TabsContent value="requirements">
          <RequirementsTab key={docsVersion} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
