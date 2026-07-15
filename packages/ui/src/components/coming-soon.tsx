import type { Icon } from "@phosphor-icons/react";
import { RocketLaunch } from "@phosphor-icons/react";
import { useT } from "../i18n/provider";
import { cn } from "../lib/cn";
import { Badge } from "./badge";

/**
 * ComingSoon — the honest, on-design "coming in a later phase" state for out-of-Phase-0 sections
 * (#9). Stakeholders navigate the *whole* product map during UAT but only test the built Phase-0
 * slice; the out-of-scope sections (Invoicing, POs & Contracts, Communications, Reports) reach this
 * shell instead of a dead link or a fake screen.
 *
 * The treatment is deliberately unmistakable — a dashed panel, muted surface, a "Later Phase" badge
 * — so a tester can never confuse it with a built feature. The complementary nav treatment (dimmed
 * item + "soon" pill) lives in {@link AppShell}. Copy is bilingual via the domain catalogue by
 * default; pass `title`/`phase`/`description` to override.
 *
 * The optional `preview` slot renders a static screen lifted from the prototype so the intended
 * flow stays legible — rendered inert (no pointer events, greyed) under a "not functional" ribbon,
 * never presented as a working backend or real persistence.
 */
export interface ComingSoonProps {
  /** The section this shell stands in for (e.g. "Invoice Processing"). */
  title: string;
  /** Badge text — the phase this lands in. Defaults to the translated "Later Phase". */
  phase?: string;
  /** Body copy override. Defaults to the translated explanation. */
  description?: string;
  /** Section glyph; defaults to a rocket. */
  icon?: Icon;
  /**
   * Optional static, non-functional preview lifted from the prototype. Rendered inert under a
   * "not functional" ribbon so testers never mistake it for a built feature.
   */
  preview?: React.ReactNode;
  className?: string;
}

export function ComingSoon({
  title,
  phase,
  description,
  icon,
  preview,
  className,
}: ComingSoonProps) {
  const t = useT();
  const IconCmp = icon ?? RocketLaunch;

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-border bg-secondary/40 px-6 py-14 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-navy/10 text-navy">
          <IconCmp size={32} weight="duotone" />
        </span>
        <Badge tone="navy">{phase ?? t("soon.badge")}</Badge>
        <div className="flex max-w-md flex-col gap-2">
          <h2 className="text-2xl font-bold text-foreground">{title}</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {description ?? t("soon.description")}
          </p>
        </div>
      </div>

      {preview && (
        <div className="relative overflow-hidden rounded-2xl border border-border">
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary/60 px-4 py-2">
            <Badge tone="warning">{t("soon.previewLabel")}</Badge>
            <span className="text-xs text-muted-foreground">{t("soon.previewHint")}</span>
          </div>
          <div aria-hidden className="pointer-events-none select-none opacity-70 grayscale">
            {preview}
          </div>
        </div>
      )}
    </div>
  );
}
