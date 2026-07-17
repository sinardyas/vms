import type { Locale } from "@vms/domain";
import { cn } from "../lib/cn";
import { SUPPORTED_LOCALES, useLocale, useT } from "./provider";

/**
 * LocaleSwitch — an ID / EN segmented toggle wired to the LocaleProvider. Bahasa Indonesia is the
 * default; foreign vendors flip to English. Drop it in the header of either app shell.
 */
const LABELS: Record<Locale, string> = { id: "ID", en: "EN" };

export function LocaleSwitch({ className }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  const t = useT();
  return (
    // biome-ignore lint/a11y/useSemanticElements: role="group" is the correct ARIA for a segmented toggle; there is no native element for it.
    <div
      role="group"
      aria-label={t("shell.aria.language")}
      className={cn("inline-flex items-center gap-0.5 rounded-lg bg-secondary p-0.5", className)}
    >
      {SUPPORTED_LOCALES.map((code) => {
        const active = code === locale;
        return (
          <button
            key={code}
            type="button"
            aria-pressed={active}
            onClick={() => setLocale(code)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-bold transition-all",
              active
                ? "bg-card text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {LABELS[code]}
          </button>
        );
      })}
    </div>
  );
}
