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
