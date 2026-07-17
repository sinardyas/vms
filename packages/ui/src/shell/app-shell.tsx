import type { Icon } from "@phosphor-icons/react";
import { List, X } from "@phosphor-icons/react";
import { useState } from "react";
import { useT } from "../i18n/provider";
import { cn } from "../lib/cn";

/**
 * AppShell — the nav frame both apps live in (M0.5). One component, two skins: the vendor Portal
 * uses the light sidebar, the staff Console the dark navy (#001a36) sidebar from the prototype.
 * Nav is grouped and RBAC-ready — screens pass only the items the signed-in role may see (M1 wires
 * `can()` into this).
 *
 * i18n split (clarified in M6.5, #90): **caller-supplied** labels — nav items, group eyebrows, the
 * page title — flow in already-translated, because only the app knows which key names its own
 * sections. The shell's **own** chrome (the menu toggles' `aria-label`s) is the shell's copy, so it
 * resolves those itself via `useT()` — as {@link LocaleSwitch}, in this same package, already does.
 * Without this the locale switch left the frame in English while everything inside it translated.
 */
export interface NavItem {
  key: string;
  label: string;
  icon?: Icon;
  /** Optional count chip (e.g. pending approvals). */
  badge?: number;
  /** Out-of-Phase-0 sections render dimmed with a "soon" tag (#9). */
  soon?: boolean;
}

export interface NavGroup {
  /** Uppercase section eyebrow (e.g. "Operations"). Omit for an ungrouped block. */
  label?: string;
  items: NavItem[];
}

export interface AppUser {
  name: string;
  role: string;
}

export interface AppShellProps {
  brand: { title: string; subtitle?: string };
  groups: NavGroup[];
  activeKey: string;
  onNavigate: (key: string) => void;
  /** Who is signed in. Omit when there is nobody to name — the block is left out rather than faked. */
  user?: AppUser;
  /** Sidebar skin: dark navy (console) or light (portal). */
  variant?: "dark" | "light";
  /** Header content on the right (locale switch, notifications…). */
  headerRight?: React.ReactNode;
  /** Page title shown in the top bar. */
  title?: React.ReactNode;
  children: React.ReactNode;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function AppShell({
  brand,
  groups,
  activeKey,
  onNavigate,
  user,
  variant = "light",
  headerRight,
  title,
  children,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const dark = variant === "dark";
  const t = useT();

  const sidebar = (
    <div
      className={cn(
        "flex h-full w-64 flex-shrink-0 flex-col",
        dark ? "bg-sidebar text-sidebar-foreground" : "border-r border-border bg-card",
      )}
    >
      {/* Brand */}
      <div
        className={cn(
          "flex h-16 items-center gap-3 px-5",
          dark ? "border-b border-white/10" : "border-b border-border",
        )}
      >
        <div
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg font-black",
            dark ? "bg-primary text-primary-foreground" : "bg-navy text-navy-foreground",
          )}
        >
          S
        </div>
        <div className="leading-tight">
          <div className={cn("text-sm font-bold", dark ? "text-white" : "text-foreground")}>
            {brand.title}
          </div>
          {brand.subtitle && (
            <div
              className={cn("text-[11px]", dark ? "text-sidebar-muted" : "text-muted-foreground")}
            >
              {brand.subtitle}
            </div>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
        {groups.map((group, gi) => (
          <div key={group.label ?? `group-${gi}`} className="flex flex-col gap-1">
            {group.label && (
              <div
                className={cn(
                  "px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest",
                  dark ? "text-sidebar-muted" : "text-muted-foreground",
                )}
              >
                {group.label}
              </div>
            )}
            {group.items.map((item) => {
              const active = item.key === activeKey;
              const IconCmp = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    onNavigate(item.key);
                    setMobileOpen(false);
                  }}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors",
                    item.soon && "opacity-60",
                    dark
                      ? active
                        ? "bg-sidebar-active text-sidebar-active-foreground"
                        : "text-sidebar-foreground hover:bg-white/5"
                      : active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  {IconCmp && <IconCmp size={18} weight={active ? "fill" : "regular"} />}
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.soon && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase",
                        dark
                          ? "bg-white/10 text-sidebar-muted"
                          : "bg-secondary text-muted-foreground",
                      )}
                    >
                      soon
                    </span>
                  )}
                  {typeof item.badge === "number" && item.badge > 0 && (
                    <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User — omitted entirely while the caller has no identity to show (the `/me` mirror is still
          loading, or nobody is signed in). Rendering nothing beats rendering a placeholder person. */}
      {user && (
        <div
          className={cn(
            "flex items-center gap-3 p-4",
            dark ? "border-t border-white/10" : "border-t border-border",
          )}
        >
          <div
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold",
              dark ? "bg-white/10 text-white" : "bg-primary/10 text-primary",
            )}
          >
            {initials(user.name)}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div
              className={cn(
                "truncate text-sm font-semibold",
                dark ? "text-white" : "text-foreground",
              )}
            >
              {user.name}
            </div>
            <div
              className={cn(
                "truncate text-xs",
                dark ? "text-sidebar-muted" : "text-muted-foreground",
              )}
            >
              {user.role}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex">{sidebar}</aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label={t("shell.aria.closeMenu")}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full animate-slide-in-right">{sidebar}</div>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-border bg-card/80 px-6 backdrop-blur">
          <button
            type="button"
            className="text-muted-foreground md:hidden"
            // Tracks the icon: this button renders an X once the drawer is open, so the label must
            // say "close" then too, or a screen reader is told the opposite of what's shown.
            aria-label={mobileOpen ? t("shell.aria.closeMenu") : t("shell.aria.openMenu")}
            onClick={() => setMobileOpen(true)}
          >
            {mobileOpen ? <X size={22} /> : <List size={22} />}
          </button>
          <div className="flex-1 truncate text-lg font-bold text-foreground">{title}</div>
          {headerRight}
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
