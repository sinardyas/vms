import { Bell } from "@phosphor-icons/react";
import type { Locale, MessageKey } from "@vms/domain";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../components/dropdown-menu";
import { useLocale, useT } from "../i18n/provider";
import { cn } from "../lib/cn";

/**
 * Notification bell (M6.3, #79, ADR-0016) — the in-app notification centre, mounted in the AppShell's
 * `headerRight` slot by **both** apps: the console for staff, the portal for vendors.
 *
 * One component for both audiences because there is one store and one API behind it. ADR-0012 sent
 * vendors email only, which would have left a portal bell permanently empty; ADR-0016 gave every
 * audience in-app rows, so the same feed is meaningful on both sides and the surfaces don't need to
 * diverge.
 *
 * Stack-neutral, like {@link CapabilitiesProvider}: the app passes a {@link NotificationApi} that knows
 * the API's origin and cookie handling, and this package never learns where the API lives. Copy arrives
 * **already rendered** by the server — rows persist message keys, not text (M6.1), and only the server
 * can safely resolve a key read out of the database — so the bell renders strings and refetches when
 * the locale changes rather than translating anything itself.
 *
 * Not to be confused with the vendor's registration **status view**, which reads the record and answers
 * "where am I now?"; this is the history of what the user was told (ADR-0016).
 */

/** One notification as the server rendered it — copy, not keys. Mirrors the API's `NotificationDTO`. */
export type NotificationItem = {
  readonly id: string;
  readonly event: string;
  readonly title: string;
  readonly body: string | null;
  readonly link: string | null;
  readonly read: boolean;
  /** ISO-8601, as sent. Rendered as a relative time — see {@link relativeTime}. */
  readonly createdAt: string;
};

/** A page of the feed. `unread` spans the whole feed, not the page — it's what the badge shows. */
export type NotificationFeedPage = {
  readonly rows: NotificationItem[];
  readonly unread: number;
  readonly total: number;
};

/** The app-supplied edges: the three calls the centre makes. */
export type NotificationApi = {
  /** Fetch a page in `locale`. The server renders the copy, so the locale rides along. */
  readonly feed: (locale: Locale, opts: { limit: number }) => Promise<NotificationFeedPage>;
  readonly markRead: (locale: Locale, id: string) => Promise<void>;
  readonly markAllRead: (locale: Locale) => Promise<void>;
};

export type NotificationBellProps = {
  readonly api: NotificationApi;
  /** Sidebar skin the bell sits against — the console header is light, so this is mostly future-proofing. */
  readonly variant?: "dark" | "light";
  /** Follow a notification's link. Omit and the row renders as plain text rather than a dead affordance. */
  readonly onNavigate?: (link: string) => void;
  /**
   * How often to re-poll the feed, in ms. Polling (rather than a socket) because Phase-0 has no
   * realtime transport and a notification is not time-critical — it's a report of something already
   * committed. `0` disables it, which is what the tests and the gallery want.
   */
  readonly pollMs?: number;
};

/** How many rows the panel holds. Deliberately short: this is a peek, not an inbox. */
const PAGE_SIZE = 10;
const DEFAULT_POLL_MS = 60_000;

/**
 * Render an ISO timestamp as a coarse relative time ("2h ago").
 *
 * Coarse on purpose — a notification's exact minute never matters, and relative time sidesteps
 * timezone rendering entirely. Anything past a week falls back to the reader's locale date, because
 * "43d ago" stops being information.
 */
export const relativeTime = (
  iso: string,
  locale: Locale,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
  now: number = Date.now(),
): string => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  // Clamp: a row written by a clock slightly ahead of this one must not render "in -1 minutes".
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return t("notify.time.now");
  if (minutes < 60) return t("notify.time.minutes", { count: minutes });
  if (hours < 24) return t("notify.time.hours", { count: hours });
  if (days <= 7) return t("notify.time.days", { count: days });
  return new Date(iso).toLocaleDateString(locale === "id" ? "id-ID" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

type Status = "loading" | "ready" | "error";

export function NotificationBell({
  api,
  variant = "light",
  onNavigate,
  pollMs = DEFAULT_POLL_MS,
}: NotificationBellProps) {
  const t = useT();
  const { locale } = useLocale();
  const [status, setStatus] = useState<Status>("loading");
  const [page, setPage] = useState<NotificationFeedPage>({ rows: [], unread: 0, total: 0 });
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setPage(await api.feed(locale, { limit: PAGE_SIZE }));
      setStatus("ready");
    } catch {
      // A failed poll must not blank a feed already on screen — keep the rows, flag the error.
      setStatus("error");
    }
  }, [api, locale]);

  // Loads on mount, and refetches on locale change by design: the copy is rendered server-side, so
  // the switch has to go back for it. The rows themselves never changed — they store keys (M6.1).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (pollMs <= 0) return;
    const id = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  const markRead = useCallback(
    async (item: NotificationItem) => {
      if (item.read) return;
      // Optimistic: the badge should drop the moment it's clicked. A failure is re-synced by the next
      // poll — and the worst case is a row that looks read and isn't, which is what the user meant.
      setPage((p) => ({
        ...p,
        rows: p.rows.map((r) => (r.id === item.id ? { ...r, read: true } : r)),
        unread: Math.max(0, p.unread - 1),
      }));
      await api.markRead(locale, item.id).catch(() => void refresh());
    },
    [api, locale, refresh],
  );

  const markAllRead = useCallback(async () => {
    setPage((p) => ({ ...p, rows: p.rows.map((r) => ({ ...r, read: true })), unread: 0 }));
    await api.markAllRead(locale).catch(() => void refresh());
  }, [api, locale, refresh]);

  const activate = useCallback(
    (item: NotificationItem) => {
      void markRead(item);
      if (item.link && onNavigate) {
        setOpen(false);
        onNavigate(item.link);
      }
    },
    [markRead, onNavigate],
  );

  const badge = useMemo(() => (page.unread > 99 ? "99+" : String(page.unread)), [page.unread]);
  const dark = variant === "dark";

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={
            page.unread > 0
              ? t("notify.centre.unreadCount", { count: page.unread })
              : t("notify.centre.open")
          }
          className={cn(
            "relative rounded-lg p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            dark
              ? "text-sidebar-muted hover:bg-white/5 hover:text-white"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          <Bell size={20} weight={page.unread > 0 ? "fill" : "regular"} />
          {page.unread > 0 && (
            <span
              // aria-hidden: the count is already in the trigger's accessible name, and a screen
              // reader announcing it twice reads as two separate notifications.
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 flex min-w-[1.15rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-destructive-foreground"
            >
              {badge}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[22rem] max-w-[calc(100vw-2rem)] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-bold text-foreground">{t("notify.centre.title")}</span>
          {page.unread > 0 && (
            <button
              type="button"
              onClick={() => void markAllRead()}
              className="text-xs font-semibold text-primary hover:underline"
            >
              {t("notify.centre.markAllRead")}
            </button>
          )}
        </div>

        <div className="max-h-[24rem] overflow-y-auto">
          {status === "loading" && page.rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t("notify.centre.loading")}
            </p>
          ) : status === "error" && page.rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8">
              <p className="text-sm text-muted-foreground">{t("notify.centre.error")}</p>
              <button
                type="button"
                onClick={() => void refresh()}
                className="text-xs font-semibold text-primary hover:underline"
              >
                {t("notify.centre.retry")}
              </button>
            </div>
          ) : page.rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t("notify.centre.empty")}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {page.rows.map((item) => {
                const actionable = Boolean(item.link && onNavigate);
                return (
                  <li key={item.id}>
                    <div
                      className={cn(
                        "flex gap-3 px-4 py-3 transition-colors",
                        !item.read && "bg-primary/5",
                        actionable && "cursor-pointer hover:bg-secondary",
                      )}
                      // A row is only a button when it has somewhere to go; otherwise it's text with
                      // a mark-read control, not a control that pretends to navigate.
                      {...(actionable
                        ? {
                            role: "button",
                            tabIndex: 0,
                            onClick: () => activate(item),
                            onKeyDown: (e: React.KeyboardEvent) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                activate(item);
                              }
                            },
                          }
                        : {})}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "mt-1.5 h-2 w-2 flex-shrink-0 rounded-full",
                          item.read ? "bg-transparent" : "bg-primary",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className={cn(
                              "truncate text-sm",
                              item.read
                                ? "font-medium text-muted-foreground"
                                : "font-bold text-foreground",
                            )}
                          >
                            {item.title}
                          </span>
                          <span className="flex-shrink-0 text-[11px] text-muted-foreground">
                            {relativeTime(item.createdAt, locale, t)}
                          </span>
                        </div>
                        {item.body && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {item.body}
                          </p>
                        )}
                        {!item.read && !actionable && (
                          <button
                            type="button"
                            onClick={() => void markRead(item)}
                            className="mt-1.5 text-[11px] font-semibold text-primary hover:underline"
                          >
                            {t("notify.centre.markRead")}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {page.total > page.rows.length && (
          <div className="border-t border-border px-4 py-2 text-center text-[11px] text-muted-foreground">
            {`${page.rows.length} / ${page.total}`}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
