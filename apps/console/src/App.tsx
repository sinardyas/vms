import type { Icon } from "@phosphor-icons/react";
import {
  Buildings,
  ChartBar,
  ChatCircleDots,
  ClipboardText,
  FileText,
  FlowArrow,
  Gauge,
  Handshake,
  Invoice,
  ListChecks,
  Package,
  SealCheck,
  ShieldCheck,
  SquaresFour,
} from "@phosphor-icons/react";
import {
  APP_NAME,
  type Locale,
  type MessageKey,
  type RbacModule,
  type SessionIdentity,
} from "@vms/domain";
import {
  AppShell,
  type AppUser,
  CapabilitiesProvider,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ComingSoon,
  Gallery,
  LocaleProvider,
  LocaleSwitch,
  type NavGroup,
  NotificationBell,
  ToastProvider,
  useCapabilities,
  useLocale,
  useT,
} from "@vms/ui";
import { useState } from "react";
import { AccessAdmin } from "./features/access-admin";
import { ApprovalRoutes } from "./features/approval-routes";
import { Approvals } from "./features/approvals";
import { AuditLog } from "./features/audit-log";
import { DocumentMaster } from "./features/document-master";
import { DocumentVerification } from "./features/document-verification";
import { OperationalLists } from "./features/operational-lists";
import { RegistrationLists } from "./features/registration-lists";
import { Vendors } from "./features/vendors";
import { loadCapabilities } from "./lib/api";
import { notificationApi } from "./lib/notifications";

/**
 * Staff Console shell (M0.5). The dark navy (#001a36) sidebar skin, mirroring the prototype's
 * staff_console.html nav (Operations / Administration groups). Real Phase-0 sections sit beside the
 * out-of-scope "soon" shells (#9).
 *
 * The nav is declared with message *keys*, resolved through `useT()` at render (M6.5, #90) — before
 * that it hardcoded English, so the locale switch changed every screen but left the console's own
 * chrome untranslated. A section's page title **is** its nav label, so one key serves both and there
 * is no parallel title table to drift.
 */
interface NavItemSpec {
  key: string;
  labelKey: MessageKey;
  icon: Icon;
  badge?: number;
  /** Out-of-Phase-0 (or not-yet-built) — routes to the ComingSoon shell instead of a screen (#9). */
  soon?: boolean;
}

const NAV: { labelKey: MessageKey; items: NavItemSpec[] }[] = [
  {
    labelKey: "console.group.operations",
    items: [
      // `soon` since M6.5 (#90): there is no dashboard screen — no `features/dashboard.tsx`, and the
      // map puts "dashboards with real metrics" in Phase 1. It previously rendered the @vms/ui
      // gallery, an M0.5 fidelity-review scaffold (#5) that every staff session opened onto. The nav
      // item stays because showing the whole product map is #9's point; it now tells the truth.
      { key: "dashboard", labelKey: "console.nav.dashboard", icon: Gauge, soon: true },
      { key: "vendors", labelKey: "console.nav.vendors", icon: Buildings },
      { key: "verification", labelKey: "console.nav.verification", icon: SealCheck, badge: 5 },
      { key: "approvals", labelKey: "console.nav.approvals", icon: ListChecks, badge: 3 },
      { key: "invoices", labelKey: "console.nav.invoices", icon: Invoice, soon: true },
      { key: "contracts", labelKey: "console.nav.contracts", icon: Handshake, soon: true },
      {
        key: "communications",
        labelKey: "console.nav.communications",
        icon: ChatCircleDots,
        soon: true,
      },
    ],
  },
  {
    labelKey: "console.group.administration",
    items: [
      { key: "master-data", labelKey: "console.nav.masterData", icon: ClipboardText },
      { key: "operational-lists", labelKey: "console.nav.operationalLists", icon: Package },
      { key: "document-master", labelKey: "console.nav.documentMaster", icon: FileText },
      { key: "approval-routes", labelKey: "console.nav.approvalRoutes", icon: FlowArrow },
      { key: "access", labelKey: "console.nav.access", icon: ShieldCheck },
      { key: "audit", labelKey: "console.nav.audit", icon: ChartBar },
      // The gallery's real home — where someone looking for the design system would go.
      { key: "components", labelKey: "console.nav.components", icon: SquaresFour },
      { key: "reports", labelKey: "console.nav.reports", icon: ChartBar, soon: true },
    ],
  },
];

/** Sections the nav flags `soon` — they render the ComingSoon shell (#9) rather than a screen. */
const SOON_KEYS = new Set(
  NAV.flatMap((g) => g.items)
    .filter((i) => i.soon)
    .map((i) => i.key),
);

/**
 * Where a session lands, and where it falls back to if the active section is gated away: the first
 * nav item that is both visible to this actor and *real* — never a `soon` shell, which would open the
 * console on a "Later Phase" panel. For a normally-granted staff account that is Vendors, the Phase-0
 * work surface. An actor granted nothing sees only ungated items, so they land on the Design System —
 * the one real section that needs no grant — rather than a stub.
 */
const landingKey = (groups: NavGroup[]): string =>
  groups.flatMap((g) => g.items).find((i) => !i.soon)?.key ?? "dashboard";

/** The signed-in staff member, as the header names them (M6.5, #90) — real identity, not a persona. */
const headerUser = (
  actor: SessionIdentity | null,
  locale: Locale,
  t: (key: MessageKey) => string,
): AppUser | undefined => {
  if (!actor) return undefined;
  // Role names are the `roles` table's own bilingual columns, so a runtime-added role still names
  // itself. Multiple roles all show — which one is acting is exactly what a UAT tester needs to see.
  const roles = actor.roles.map((r) => (locale === "id" ? r.nameId : r.nameEn));
  return {
    name: actor.name,
    role: roles.length > 0 ? roles.join(" · ") : t("console.shell.noRole"),
  };
};

/**
 * Capability gate per nav key (M1.3, #22): a real Phase-0 section shows only when the actor holds
 * `<module>:view` — the same grant its backing route enforces server-side, so a hidden nav item is a
 * request that would 403. Keys absent here are always shown: the Design System (client-only, nothing
 * to refuse) and the `soon` shells (visibly stubs, no backend behind them). M2 refines Master Data's
 * gate as its sub-screens land (each on its own module); `registration_lists` is the proxy for now.
 */
const NAV_GATE: Partial<Record<string, RbacModule>> = {
  vendors: "vendors",
  verification: "documents",
  approvals: "approvals",
  "master-data": "registration_lists",
  "operational-lists": "operational_lists",
  "document-master": "document_master",
  "approval-routes": "approval_routes",
  access: "access",
  audit: "audit",
};

/** In-scope Phase-0 screen that hasn't landed yet — distinct from the out-of-Phase-0 shell. */
function Placeholder({ title }: { title: string }) {
  const t = useT();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {t("console.placeholder.body")}
      </CardContent>
    </Card>
  );
}

/**
 * The console proper — reads the live capability grid (M1.3) and shows only the nav the signed-in
 * actor may reach. Runs inside {@link CapabilitiesProvider}, so `useCapabilities().can` reflects the
 * server's `/me` grid; until it loads (or with no session) gated items stay hidden — deny-by-default.
 */
/**
 * Which console section a notification's link refers to.
 *
 * Notification links are absolute URLs built server-side (M6.2), where the console's origin is known
 * but its client-side section keys are not; the console has no router, so a link is matched by path
 * rather than followed. `step_assigned` — the only event that reaches staff today — points at an
 * approval. A section the actor can't view is filtered out of the nav and falls back to the landing
 * section below, so this never lands someone on a screen their grid denies.
 */
const sectionFor = (link: string): string => {
  const path = (URL.canParse(link) ? new URL(link).pathname : link).toLowerCase();
  if (path.includes("approval")) return "approvals";
  if (path.includes("verification")) return "verification";
  if (path.includes("vendor")) return "vendors";
  // Unrecognized link → the work surface, not the Dashboard: that's a `soon` shell now (#90), and a
  // notification should never land someone on a "Later Phase" panel. If `vendors` is gated away for
  // this actor, the landing fallback below catches it.
  return "vendors";
};

function Console() {
  // Land on the Phase-0 work surface. (Until M6.5 this was "dashboard", which rendered the design-
  // system gallery — so every staff session opened onto a fidelity-review scaffold.)
  const [active, setActive] = useState("vendors");
  const { can, actor } = useCapabilities();
  const { locale } = useLocale();
  const t = useT();

  // Resolve labels here, not at module scope: `t` changes with the locale, so the nav re-renders in
  // the chosen language. Hide any real section the actor can't `view`; keep ungated items.
  const groups: NavGroup[] = NAV.map((group) => ({
    label: t(group.labelKey),
    items: group.items
      .filter((item) => {
        const module = NAV_GATE[item.key];
        return module === undefined || can(module, "view");
      })
      .map(({ key, labelKey, icon, badge, soon }) => ({
        key,
        label: t(labelKey),
        icon,
        badge,
        soon,
      })),
  })).filter((group) => group.items.length > 0);

  // A section's title is its nav label — one string, so the header can't disagree with the menu.
  const items = groups.flatMap((g) => g.items);
  const visibleKeys = new Set(items.map((i) => i.key));
  // If the active section got gated away, fall back to a real section rather than a shell.
  const current = visibleKeys.has(active) ? active : landingKey(groups);
  const showGallery = current === "components";
  const title = items.find((i) => i.key === current)?.label ?? APP_NAME;

  return (
    <AppShell
      variant="dark"
      brand={{ title: APP_NAME, subtitle: t("console.shell.subtitle") }}
      groups={groups}
      activeKey={current}
      onNavigate={setActive}
      user={headerUser(actor, locale, t)}
      title={title}
      headerRight={
        <div className="flex items-center gap-2">
          {/* Staff notification centre (M6.3) — `step_assigned` lands here the moment a step opens. */}
          <NotificationBell
            api={notificationApi}
            onNavigate={(link) => setActive(sectionFor(link))}
          />
          <LocaleSwitch />
        </div>
      }
    >
      {showGallery ? (
        <Gallery />
      ) : current === "vendors" ? (
        <Vendors />
      ) : current === "verification" ? (
        <DocumentVerification />
      ) : current === "approvals" ? (
        <Approvals />
      ) : current === "audit" ? (
        <AuditLog />
      ) : current === "access" ? (
        <AccessAdmin />
      ) : current === "master-data" ? (
        <RegistrationLists />
      ) : current === "operational-lists" ? (
        <OperationalLists />
      ) : current === "document-master" ? (
        <DocumentMaster />
      ) : current === "approval-routes" ? (
        <ApprovalRoutes />
      ) : SOON_KEYS.has(current) ? (
        <ComingSoon title={title} />
      ) : (
        <Placeholder title={title} />
      )}
    </AppShell>
  );
}

export default function App() {
  return (
    <LocaleProvider>
      <ToastProvider>
        <CapabilitiesProvider load={loadCapabilities}>
          <Console />
        </CapabilitiesProvider>
      </ToastProvider>
    </LocaleProvider>
  );
}
