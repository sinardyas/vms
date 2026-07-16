/**
 * Notification domain (M6.1, ADR-0012) — the stack-neutral half of the notification service.
 *
 * What belongs here: the event catalogue, the channel-by-audience policy, the templates, and the
 * params each event validates. What does **not**: SMTP, Drizzle, recipient lookup — delivery is the
 * API's `notifications.ts`, keeping this package free of Hono/React/Drizzle as M0.3 requires.
 */

export * from "./channels";
export * from "./events";
export * from "./templates";
