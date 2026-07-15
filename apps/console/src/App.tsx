import {
  Buildings,
  ChartBar,
  ChatCircleDots,
  ClipboardText,
  Gauge,
  Handshake,
  Invoice,
  ListChecks,
  SealCheck,
  ShieldCheck,
  SquaresFour,
} from "@phosphor-icons/react";
import { APP_NAME } from "@vms/domain";
import {
  AppShell,
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
} from "@vms/ui";
import { useState } from "react";

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

export default function App() {
  const [active, setActive] = useState("dashboard");
  const showGallery = active === "dashboard" || active === "components";
  const title = TITLES[active] ?? "Section";

  return (
    <LocaleProvider>
      <ToastProvider>
        <AppShell
          variant="dark"
          brand={{ title: APP_NAME, subtitle: "Staff Console" }}
          groups={NAV}
          activeKey={active}
          onNavigate={setActive}
          user={{ name: "Sari Wijaya", role: "Vendor Administrator" }}
          title={TITLES[active] ?? APP_NAME}
          headerRight={<LocaleSwitch />}
        >
          {showGallery ? (
            <Gallery />
          ) : SOON_KEYS.has(active) ? (
            <ComingSoon title={title} />
          ) : (
            <Placeholder title={title} />
          )}
        </AppShell>
      </ToastProvider>
    </LocaleProvider>
  );
}
