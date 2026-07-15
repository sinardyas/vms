import type { ReactNode } from "react";

/**
 * @vms/ui — React design system.
 *
 * Placeholder for the scaffold (ticket #2). The real tokens + components extracted from the
 * prototype / DESIGN_GUIDELINES.md land in tickets #4 and #5. `AppShell` exists only so the
 * portal and console apps have something real to import and render.
 */

export const UI_VERSION = "0.0.0";

export function AppShell({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="vms-app-shell">
      <header className="vms-app-shell__header">
        <h1>{title}</h1>
      </header>
      <main className="vms-app-shell__main">{children}</main>
    </div>
  );
}
