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
  SealCheck,
  ShieldCheck,
  SquaresFour,
} from "@phosphor-icons/react";
import { APP_NAME, type RbacModule } from "@vms/domain";
import {
  AppShell,
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
  ToastProvider,
  useCapabilities,
} from "@vms/ui";
import { useState } from "react";
import { AccessAdmin } from "./features/access-admin";
import { ApprovalRoutes } from "./features/approval-routes";
import { AuditLog } from "./features/audit-log";
import { DocumentMaster } from "./features/document-master";
import { RegistrationLists } from "./features/registration-lists";
import { loadCapabilities } from "./lib/api";

/**
 * Staff Console shell (M0.5). The dark navy (#001a36) sidebar skin, mirroring the prototype's
 * staff_console.html nav (Operations / Administration groups). Real Phase-0 sections sit beside the
 * out-of-scope "soon" shells (#9). The Dashboard renders the @vms/ui gallery for fidelity review.
 */
const NAV: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { key: "dashboard", label: "Dashboard", icon: Gauge },
      { key: "vendors", label: "Vendors", icon: Buildings },
      { key: "verification", label: "Document Verification", icon: SealCheck, badge: 5 },
      { key: "approvals", label: "Approvals", icon: ListChecks, badge: 3 },
      { key: "invoices", label: "Invoice Processing", icon: Invoice, soon: true },
      { key: "contracts", label: "POs & Contracts", icon: Handshake, soon: true },
      { key: "communications", label: "Communications", icon: ChatCircleDots, soon: true },
    ],
  },
  {
    label: "Administration",
    items: [
      { key: "master-data", label: "Master Data", icon: ClipboardText },
      { key: "document-master", label: "Document Master", icon: FileText },
      { key: "approval-routes", label: "Approval Routes", icon: FlowArrow },
      { key: "access", label: "Access Control", icon: ShieldCheck },
      { key: "audit", label: "Audit Log", icon: ChartBar },
      { key: "components", label: "Design System", icon: SquaresFour },
      { key: "reports", label: "Reports", icon: ChartBar, soon: true },
    ],
  },
];

const TITLES: Record<string, string> = {
  dashboard: "Operations Dashboard",
  vendors: "Vendors",
  verification: "Document Verification",
  approvals: "Approvals",
  invoices: "Invoice Processing",
  contracts: "POs & Contracts",
  communications: "Communications",
  "master-data": "Master Data",
  "document-master": "Document Master",
  "approval-routes": "Approval Routes",
  access: "Access Control",
  audit: "Audit Log",
  components: "Design System",
  reports: "Reports",
};

/** Out-of-Phase-0 sections — the ones the nav flags `soon` — render the ComingSoon shell (#9). */
const SOON_KEYS = new Set(
  NAV.flatMap((g) => g.items)
    .filter((i) => i.soon)
    .map((i) => i.key),
);

/**
 * Capability gate per nav key (M1.3, #22): a real Phase-0 section shows only when the actor holds
 * `<module>:view` — the same grant its backing route enforces server-side, so a hidden nav item is a
 * request that would 403. Keys absent here are always shown: the Dashboard/Design-System landing and
 * the out-of-Phase-0 `soon` shells (visibly stubs, no backend to refuse). M2 refines Master Data's
 * gate as its sub-screens land (each on its own module); `registration_lists` is the proxy for now.
 */
const NAV_GATE: Partial<Record<string, RbacModule>> = {
  vendors: "vendors",
  verification: "documents",
  approvals: "approvals",
  "master-data": "registration_lists",
  "document-master": "document_master",
  "approval-routes": "approval_routes",
  access: "access",
  audit: "audit",
};

/** In-scope Phase-0 screen that hasn't landed yet — distinct from the out-of-Phase-0 shell. */
function Placeholder({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Phase-0 scaffold. This screen lands in a later milestone (see the wayfinder map).
      </CardContent>
    </Card>
  );
}

/**
 * The console proper — reads the live capability grid (M1.3) and shows only the nav the signed-in
 * actor may reach. Runs inside {@link CapabilitiesProvider}, so `useCapabilities().can` reflects the
 * server's `/me` grid; until it loads (or with no session) gated items stay hidden — deny-by-default.
 */
function Console() {
  const [active, setActive] = useState("dashboard");
  const { can } = useCapabilities();

  // Hide any real section the actor can't `view`; keep ungated items (landing + `soon` shells).
  const groups: NavGroup[] = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      const module = NAV_GATE[item.key];
      return module === undefined || can(module, "view");
    }),
  })).filter((group) => group.items.length > 0);

  // If the active section got gated away, fall back to the always-present Dashboard.
  const visibleKeys = new Set(groups.flatMap((g) => g.items).map((i) => i.key));
  const current = visibleKeys.has(active) ? active : "dashboard";
  const showGallery = current === "dashboard" || current === "components";
  const title = TITLES[current] ?? "Section";

  return (
    <AppShell
      variant="dark"
      brand={{ title: APP_NAME, subtitle: "Staff Console" }}
      groups={groups}
      activeKey={current}
      onNavigate={setActive}
      user={{ name: "Sari Wijaya", role: "Vendor Administrator" }}
      title={TITLES[current] ?? APP_NAME}
      headerRight={<LocaleSwitch />}
    >
      {showGallery ? (
        <Gallery />
      ) : current === "audit" ? (
        <AuditLog />
      ) : current === "access" ? (
        <AccessAdmin />
      ) : current === "master-data" ? (
        <RegistrationLists />
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
