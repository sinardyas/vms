/**
 * Console → notification centre (M6.3, #79, ADR-0016).
 *
 * The `@vms/ui` bell is stack-neutral — it takes a {@link NotificationApi} and never learns where the
 * API lives. This is the console's binding of it, over the shared `request` helper (base URL, session
 * cookie, `?lang`). The portal has the mirror of this file; both hit the same self-scoped routes,
 * which read the session's own rows and need no RBAC grant.
 */

import type { NotificationApi, NotificationFeedPage } from "@vms/ui";
import { request } from "./vendors";

export const notificationApi: NotificationApi = {
  feed: (locale, { limit }) =>
    request<NotificationFeedPage>(`/notifications?limit=${limit}`, locale),
  markRead: (locale, id) =>
    request<{ ok: true }>(`/notifications/${id}/read`, locale, { method: "POST" }).then(
      () => undefined,
    ),
  markAllRead: (locale) =>
    request<{ ok: true; marked: number }>("/notifications/read-all", locale, {
      method: "POST",
    }).then(() => undefined),
};
