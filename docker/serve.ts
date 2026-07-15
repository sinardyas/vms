/**
 * Minimal Bun static-file server for the built SPA frontends (portal, console).
 *
 * Serves a Vite `dist/` directory with SPA history fallback: any path that does not
 * resolve to a real file falls back to `index.html`, so client-side routes work on
 * hard refresh. Keeps the frontend images Bun-native (no nginx) — same runtime as the API.
 *
 * Env:
 *   PORT         — listen port (default 8080)
 *   STATIC_ROOT  — directory to serve (default ./dist)
 */
import { join, normalize } from "node:path";
import { file } from "bun";

const root = process.env.STATIC_ROOT ?? "./dist";
const port = Number(process.env.PORT ?? 8080);
const indexHtml = join(root, "index.html");

Bun.serve({
  port,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);

    // Container healthcheck endpoint.
    if (url.pathname === "/healthz") {
      return new Response("ok", { headers: { "content-type": "text/plain" } });
    }

    // Resolve within root; `normalize` collapses `..` so requests can't escape the dir.
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    const candidate = file(join(root, rel));

    if (rel !== "/" && rel !== "" && (await candidate.exists())) {
      return new Response(candidate);
    }

    // SPA fallback — unknown path → index.html.
    return new Response(file(indexHtml), { headers: { "content-type": "text/html" } });
  },
});

console.log(`Serving ${root} on :${port}`);
