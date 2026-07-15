import { ArrowClockwise, Warning } from "@phosphor-icons/react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
 * Audit Log — the M0.6 walking skeleton's React end (#8).
 *
 * The one screen that exercises the whole stack: it calls `GET /console/audit`, which passes the RBAC
 * guard, writes an audit row, and reads the log back; here that response is rendered with `@vms/ui`
 * primitives and localised through `useT`. Loading it appends a `audit.viewed` row, so a refresh
 * always shows at least one entry — the trail growing is the proof the round-trip is live.
 */

type AuditRow = {
  id: string;
  at: string;
  actorUserId: string | null;
  action: string;
  module: string | null;
  subjectType: string;
  subjectId: string | null;
  ip: string | null;
};

type AuditResponse = {
  actor: { name: string; email: string } | null;
  locale: string;
  rows: AuditRow[];
};

type State = { status: "loading" } | { status: "error" } | { status: "ready"; data: AuditResponse };

export function AuditLog() {
  const t = useT();
  const { locale } = useLocale();
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      // Pass the active locale so the server localises any error (401/403) into the same language.
      const res = await fetch(apiUrl(`/console/audit?lang=${locale}`));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState({ status: "ready", data: (await res.json()) as AuditResponse });
    } catch {
      setState({ status: "error" });
    }
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const timeFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{t("audit.title")}</CardTitle>
          <CardDescription>{t("audit.subtitle")}</CardDescription>
          {state.status === "ready" && state.data.actor && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("audit.signedInAs", { name: state.data.actor.name })}
            </p>
          )}
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

      <CardContent>
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
                  <TableEmpty colSpan={6}>{t("audit.empty")}</TableEmpty>
                ) : (
                  state.data.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {timeFmt.format(new Date(row.at))}
                      </TableCell>
                      <TableCell>
                        {row.actorUserId ? (
                          (state.data.actor?.name ?? row.actorUserId)
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
                        {row.module ? <Badge tone="navy">{row.module}</Badge> : "—"}
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
      </CardContent>
    </Card>
  );
}
