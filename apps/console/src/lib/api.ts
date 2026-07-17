/**
 * API access for the Staff Console.
 *
 * The API is a separate origin (its own service / port), so its base URL is baked at build time from
 * `VITE_API_URL` (see the Dockerfile build arg / docker-compose). Falls back to the dev port for a
 * bare `bun run dev`. All console → API calls go through {@link apiUrl} so the base lives in one place.
 */

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

/** Build an absolute API URL for `path` (which must start with `/`). */
export const apiUrl = (path: string): string => `${API_URL}${path}`;

import type { CapabilityFlags, SessionIdentity } from "@vms/domain";
import type { CapabilitiesSnapshot } from "@vms/ui";

/**
 * Load the `GET /me` mirror (M1.3, #22) — who is signed in, plus the capability grid the nav gates on.
 * `credentials: "include"` sends the better-auth session cookie cross-origin (the API's CORS allows
 * it). A 401 means no session: return `null` so the UI stays deny-all rather than treating the absence
 * of a grid as an error.
 */
export async function loadCapabilities(): Promise<CapabilitiesSnapshot | null> {
  const res = await fetch(apiUrl("/me"), { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { actor: SessionIdentity; capabilities: CapabilityFlags };
  return { actor: body.actor, flags: body.capabilities };
}
