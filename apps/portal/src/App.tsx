/**
 * Vendor Portal shell (M3.5, #46).
 *
 * The light-sidebar skin of the shared AppShell, gated on a live session. Unauthenticated (no session /
 * unverified email) → the auth screens; signed in → the portal proper: Dashboard, **My Registration**
 * (the resumable self-registration wizard), Documents, beside the out-of-Phase-0 "soon" shells (#9).
 *
 * Session presence is read through the capability mirror (`GET /me`): `anonymous`/`error` means no
 * usable session, `ready` means signed in. Signing in or out re-loads the grid, flipping the whole app.
 */

import {
  ChatCircleDots,
  FileText,
  Gauge,
  Invoice,
  Package,
  UserCircle,
} from "@phosphor-icons/react";
import { APP_NAME } from "@vms/domain";
import {
  AppShell,
  Button,
  CapabilitiesProvider,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ComingSoon,
  LocaleProvider,
  LocaleSwitch,
  type NavGroup,
  NotificationBell,
  StatusPill,
  ToastProvider,
  useCapabilities,
  useLocale,
  useT,
} from "@vms/ui";
import { useEffect, useState } from "react";
import { AuthScreens } from "./features/auth-screens";
import { Registration } from "./features/registration";
import { loadCapabilities } from "./lib/api";
import { signOut } from "./lib/auth";
import { notificationApi } from "./lib/notifications";
import { type VendorDTO, vendorApi } from "./lib/vendor";

/** A small landing card: the vendor's current registration status + a jump into the wizard. */
function Dashboard({ onGoRegister }: { onGoRegister: () => void }) {
  const { locale } = useLocale();
  const t = useT();
  const [vendor, setVendor] = useState<VendorDTO | null>(null);
  useEffect(() => {
    vendorApi
      .getMe(locale)
      .then(setVendor)
      .catch(() => setVendor(null));
  }, [locale]);

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{t("portal.status.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {vendor ? (
          <>
            <div className="flex items-center gap-3">
              <span className="font-bold text-foreground">{vendor.name}</span>
              <StatusPill tone={vendor.status === "draft" ? "neutral" : "pending"}>
                {vendor.status === "draft" ? t("portal.status.draft") : t("portal.status.pending")}
              </StatusPill>
            </div>
            <p className="text-sm text-muted-foreground">
              {vendor.status === "draft"
                ? t("portal.status.draftBody")
                : t("portal.status.pendingBody")}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("portal.reg.startBody")}</p>
        )}
        <div>
          <Button onClick={onGoRegister}>{t("portal.nav.registration")}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Which portal section a notification's link refers to.
 *
 * Notification links are absolute URLs — M6.2 builds them server-side, where the portal's origin is
 * known but its client-side section keys are not. The portal has no router (sections are state), so a
 * link is matched by path rather than followed: every Phase-0 vendor notification concerns the
 * registration, and `documents` is the one sub-view worth landing on directly.
 */
const sectionFor = (link: string): string => {
  const path = (URL.canParse(link) ? new URL(link).pathname : link).toLowerCase();
  return path.includes("document") ? "documents" : "registration";
};

/** The authenticated portal — nav + section switch. */
function Portal() {
  const t = useT();
  const { reload } = useCapabilities();
  const [active, setActive] = useState("dashboard");

  const nav: NavGroup[] = [
    {
      label: t("portal.shell.subtitle"),
      items: [
        { key: "dashboard", label: t("portal.nav.dashboard"), icon: Gauge },
        { key: "registration", label: t("portal.nav.registration"), icon: UserCircle },
        { key: "documents", label: t("portal.nav.documents"), icon: FileText },
      ],
    },
    {
      label: t("soon.badge"),
      items: [
        { key: "invoices", label: "Invoices", icon: Invoice, soon: true },
        { key: "orders", label: "Purchase Orders", icon: Package, soon: true },
        { key: "messages", label: "Communications", icon: ChatCircleDots, soon: true },
      ],
    },
  ];

  const soon = new Set(
    nav
      .flatMap((g) => g.items)
      .filter((i) => i.soon)
      .map((i) => i.key),
  );

  const doSignOut = async () => {
    await signOut();
    reload();
  };

  const titleKey =
    active === "registration"
      ? "portal.nav.registration"
      : active === "documents"
        ? "portal.nav.documents"
        : "portal.nav.dashboard";

  return (
    <AppShell
      variant="light"
      brand={{ title: APP_NAME, subtitle: t("portal.shell.subtitle") }}
      groups={nav}
      activeKey={active}
      onNavigate={setActive}
      user={{ name: APP_NAME, role: t("portal.shell.subtitle") }}
      title={t(titleKey)}
      headerRight={
        <div className="flex items-center gap-2">
          {/* The vendor's notification centre (M6.3). Its links point at portal sections, so a click
              navigates in-app rather than reloading. */}
          <NotificationBell
            api={notificationApi}
            onNavigate={(link) => setActive(sectionFor(link))}
          />
          <LocaleSwitch />
          <Button variant="ghost" size="sm" onClick={doSignOut}>
            {t("portal.auth.signOut")}
          </Button>
        </div>
      }
    >
      {active === "dashboard" ? (
        <Dashboard onGoRegister={() => setActive("registration")} />
      ) : active === "registration" ? (
        <Registration />
      ) : active === "documents" ? (
        <Registration documentsOnly />
      ) : soon.has(active) ? (
        <ComingSoon title={active} />
      ) : (
        <Dashboard onGoRegister={() => setActive("registration")} />
      )}
    </AppShell>
  );
}

/** Session gate: loading → spinner; no session → auth screens; signed in → the portal. */
function Root() {
  const t = useT();
  const { status, reload } = useCapabilities();

  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        {t("portal.common.loading")}
      </div>
    );
  }
  if (status === "anonymous" || status === "error") {
    return <AuthScreens onSignedIn={reload} />;
  }
  return <Portal />;
}

export default function App() {
  return (
    <LocaleProvider>
      <ToastProvider>
        <CapabilitiesProvider load={loadCapabilities}>
          <Root />
        </CapabilitiesProvider>
      </ToastProvider>
    </LocaleProvider>
  );
}
