import {
  DEFAULT_LOCALE,
  LOCALES,
  type Locale,
  type MessageKey,
  type MessageParams,
  resolveLocale,
  translate,
} from "@vms/domain";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * i18n React binding (M0.5). The domain package owns the catalogue + `translate`; this provider
 * holds the *current* locale for a running app and re-renders on switch. Bilingual (ID default /
 * EN) per the Definition-of-Done: screens call `useT()` and never hard-code strings.
 */
interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Bound translator for the current locale. */
  t: (key: MessageKey, params?: MessageParams) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

const STORAGE_KEY = "vms.locale";

function readInitialLocale(fallback: Locale): Locale {
  if (typeof window === "undefined") return fallback;
  try {
    return resolveLocale(window.localStorage.getItem(STORAGE_KEY) ?? fallback);
  } catch {
    return fallback;
  }
}

export function LocaleProvider({
  children,
  defaultLocale = DEFAULT_LOCALE,
}: {
  children: React.ReactNode;
  defaultLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(() => readInitialLocale(defaultLocale));

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable (private mode) — locale still lives in memory */
    }
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback(
    (key: MessageKey, params?: MessageParams) => translate(key, locale, params),
    [locale],
  );

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

function useLocaleContext(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("i18n hooks must be used within a <LocaleProvider>");
  return ctx;
}

/** `{ locale, setLocale }` — read or switch the active locale. */
export function useLocale(): Pick<LocaleContextValue, "locale" | "setLocale"> {
  const { locale, setLocale } = useLocaleContext();
  return { locale, setLocale };
}

/** The bound translator for the current locale: `const t = useT(); t("error.forbidden")`. */
export function useT(): LocaleContextValue["t"] {
  return useLocaleContext().t;
}

/** The supported locales, for building switchers. */
export const SUPPORTED_LOCALES = LOCALES;
