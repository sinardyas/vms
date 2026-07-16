/**
 * Portal → notification centre (M6.3, #79, ADR-0016).
 *
 * The vendor's half of the bell. It exists at all because ADR-0016 superseded ADR-0012's "vendors →
 * email only": vendors now accumulate in-app rows, so this feed has content rather than being
 * structurally empty. Mirrors `apps/console/src/lib/notifications.ts` — same self-scoped routes, the
 * portal's own `request` helper (base URL, session cookie, `?lang`).
 *
 * Distinct from the registration **status view**, which reads the vendor record to say where the
 * registration stands now; this is the history of what the vendor was told (ADR-0016).
 */

import type { NotificationApi, NotificationFeedPage } from "@vms/ui";
import { request } from "./api";

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
