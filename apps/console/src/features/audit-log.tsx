import {
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  MagnifyingGlass,
  Warning,
} from "@phosphor-icons/react";
import { type MessageKey, RBAC_MODULES, type RbacModule } from "@vms/domain";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  useLocale,
  useT,
} from "@vms/ui";
import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "../lib/api";

/**
 * Audit Log — the M1.4 module proper (#23), grown from the M0.6 walking skeleton (#8).
 *
 * Reads `GET /console/audit` (RBAC-gated `audit:view`) with filters on actor, action, module,
 * subject and a date range, and pages through the result. Every string is localised through
 * `useT`; the module code is rendered with its `enum.rbacModule.*` label. This is a read: loading
 * or filtering never writes to the trail — its content is the mutations the system records.
 */

type AuditRow = {
  id: string;
  at: string;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  module: string | null;
  subjectType: string;
  subjectId: string | null;
  ip: string | null;
};

type AuditPage = { rows: AuditRow[]; total: number; limit: number; offset: number };

type State = { status: "loading" } | { status: "error" } | { status: "ready"; data: AuditPage };

/** How many rows a page shows; mirrors the server's default limit. */
const PAGE_SIZE = 50;

/** The filter bar's fields. `module` is `"all"` (no filter) or an {@link RbacModule} code. */
type Filters = {
  actor: string;
  action: string;
  module: string;
  subject: string;
  from: string;
  to: string;
};
const EMPTY_FILTERS: Filters = {
  actor: "",
  action: "",
  module: "all",
  subject: "",
  from: "",
  to: "",
};

/** The typed i18n key for a module's human label — every code has one (see the catalogue). */
const moduleLabelKey = (module: RbacModule): MessageKey => `enum.rbacModule.${module}`;

/** Build the `/console/audit` query string from the applied filters and the current page. */
function buildQuery(filters: Filters, offset: number, locale: string): string {
  const params = new URLSearchParams();
  if (filters.actor.trim()) params.set("actor", filters.actor.trim());
  if (filters.action.trim()) params.set("action", filters.action.trim());
  if (filters.module !== "all") params.set("module", filters.module);
  if (filters.subject.trim()) params.set("subjectType", filters.subject.trim());
  // Date inputs are day-precise; widen `to` to end-of-day so the whole day is included.
  if (filters.from) params.set("from", `${filters.from}T00:00:00.000Z`);
  if (filters.to) params.set("to", `${filters.to}T23:59:59.999Z`);
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(offset));
  params.set("lang", locale); // localise any 401/403 into the active language
  return params.toString();
}

export function AuditLog() {
  const t = useT();
  const { locale } = useLocale();

  // `draft` is what the inputs hold; `applied` is what's been submitted and drives the fetch. The
  // split lets a user compose a filter set and apply it once, rather than refetching on every keypress.
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch(apiUrl(`/console/audit?${buildQuery(applied, offset, locale)}`), {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState({ status: "ready", data: (await res.json()) as AuditPage });
    } catch {
      setState({ status: "error" });
    }
  }, [applied, offset, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    setOffset(0); // a new filter set always starts at the first page
    setApplied(draft);
  };

  const clear = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setOffset(0);
  };

  const hasFilters = JSON.stringify(applied) !== JSON.stringify(EMPTY_FILTERS);
  const timeFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" });

  const total = state.status === "ready" ? state.data.total : 0;
  const shown = state.status === "ready" ? state.data.rows.length : 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = offset + shown;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{t("audit.title")}</CardTitle>
          <CardDescription>{t("audit.subtitle")}</CardDescription>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void load()}
          disabled={state.status === "loading"}
        >
          <ArrowClockwise weight="bold" />
          {t("audit.refresh")}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Filter bar — submit (or Enter) applies; Clear resets to the unfiltered view. */}
        <form
          onSubmit={apply}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
        >
          <Field label={t("audit.filter.actor")}>
            {(f) => (
              <Input
                {...f}
                value={draft.actor}
                onChange={(e) => setDraft({ ...draft, actor: e.target.value })}
                placeholder={t("audit.filter.actorPlaceholder")}
              />
            )}
          </Field>
          <Field label={t("audit.filter.action")}>
            {(f) => (
              <Input
                {...f}
                value={draft.action}
                onChange={(e) => setDraft({ ...draft, action: e.target.value })}
                placeholder={t("audit.filter.actionPlaceholder")}
              />
            )}
          </Field>
          <Field label={t("audit.filter.module")}>
            {(f) => (
              <Select value={draft.module} onValueChange={(v) => setDraft({ ...draft, module: v })}>
                <SelectTrigger id={f.id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("audit.filter.moduleAll")}</SelectItem>
                  {RBAC_MODULES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {t(moduleLabelKey(m))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label={t("audit.filter.subject")}>
            {(f) => (
              <Input
                {...f}
                value={draft.subject}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                placeholder={t("audit.filter.subjectPlaceholder")}
              />
            )}
          </Field>
          <Field label={t("audit.filter.from")}>
            {(f) => (
              <Input
                {...f}
                type="date"
                value={draft.from}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              />
            )}
          </Field>
          <Field label={t("audit.filter.to")}>
            {(f) => (
              <Input
                {...f}
                type="date"
                value={draft.to}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              />
            )}
          </Field>

          <div className="flex items-end gap-2 xl:col-span-6">
            <Button type="submit" size="sm" disabled={state.status === "loading"}>
              <MagnifyingGlass weight="bold" />
              {t("audit.filter.apply")}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={!hasFilters}>
              {t("audit.filter.clear")}
            </Button>
          </div>
        </form>

        {state.status === "error" ? (
          <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
            <Warning weight="fill" />
            {t("audit.loadError")}
          </div>
        ) : (
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("audit.col.time")}</TableHead>
                  <TableHead>{t("audit.col.actor")}</TableHead>
                  <TableHead>{t("audit.col.action")}</TableHead>
                  <TableHead>{t("audit.col.module")}</TableHead>
                  <TableHead>{t("audit.col.subject")}</TableHead>
                  <TableHead>{t("audit.col.ip")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.status === "loading" ? (
                  <TableEmpty colSpan={6}>{t("audit.loading")}</TableEmpty>
                ) : state.data.rows.length === 0 ? (
                  <TableEmpty colSpan={6}>
                    {hasFilters ? t("audit.noResults") : t("audit.empty")}
                  </TableEmpty>
                ) : (
                  state.data.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {timeFmt.format(new Date(row.at))}
                      </TableCell>
                      <TableCell>
                        {row.actorUserId ? (
                          <span title={row.actorEmail ?? undefined}>
                            {row.actorName ?? row.actorUserId}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{t("audit.system")}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">
                          {row.action}
                        </code>
                      </TableCell>
                      <TableCell>
                        {row.module ? (
                          <Badge tone="navy">{t(moduleLabelKey(row.module as RbacModule))}</Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.subjectType}</TableCell>
                      <TableCell className="text-muted-foreground">{row.ip ?? "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* Pager — only meaningful once there's a page to describe. */}
        {state.status === "ready" && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{t("audit.page.showing", { from, to, total })}</span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                disabled={offset === 0}
              >
                <CaretLeft weight="bold" />
                {t("audit.page.prev")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setOffset(offset + PAGE_SIZE)}
                disabled={to >= total}
              >
                {t("audit.page.next")}
                <CaretRight weight="bold" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
