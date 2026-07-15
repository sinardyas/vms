import {
  ChatCircleDots,
  FileText,
  Gauge,
  Invoice,
  Package,
  SquaresFour,
  UserCircle,
} from "@phosphor-icons/react";
import { APP_NAME } from "@vms/domain";
import {
  AppShell,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Gallery,
  LocaleProvider,
  LocaleSwitch,
  type NavGroup,
  ToastProvider,
} from "@vms/ui";
import { useState } from "react";

/**
 * Vendor Portal shell (M0.5). The light-sidebar skin of the shared AppShell. Real Phase-0 sections
 * (Registration, Documents) sit beside the out-of-scope "soon" shells (#9). The Dashboard renders
 * the @vms/ui gallery so reviewers can eyeball the extracted design system against the prototype.
 */
const NAV: NavGroup[] = [
  {
    label: "Vendor Portal",
    items: [
      { key: "dashboard", label: "Dashboard", icon: Gauge },
      { key: "registration", label: "My Registration", icon: UserCircle },
      { key: "documents", label: "Documents", icon: FileText },
      { key: "components", label: "Design System", icon: SquaresFour },
    ],
  },
  {
    label: "Coming soon",
    items: [
      { key: "invoices", label: "Invoices", icon: Invoice, soon: true },
      { key: "orders", label: "Purchase Orders", icon: Package, soon: true },
      { key: "messages", label: "Communications", icon: ChatCircleDots, soon: true },
    ],
  },
];

const TITLES: Record<string, string> = {
  dashboard: "Dashboard",
  registration: "My Registration",
  documents: "Documents",
  components: "Design System",
  invoices: "Invoices",
  orders: "Purchase Orders",
  messages: "Communications",
};

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

  return (
    <LocaleProvider>
      <ToastProvider>
        <AppShell
          variant="light"
          brand={{ title: APP_NAME, subtitle: "Vendor Portal" }}
          groups={NAV}
          activeKey={active}
          onNavigate={setActive}
          user={{ name: "Budi Santoso", role: "Vendor Owner" }}
          title={TITLES[active] ?? APP_NAME}
          headerRight={<LocaleSwitch />}
        >
          {showGallery ? <Gallery /> : <Placeholder title={TITLES[active] ?? "Section"} />}
        </AppShell>
      </ToastProvider>
    </LocaleProvider>
  );
}
