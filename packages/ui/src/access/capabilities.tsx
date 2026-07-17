import type { CapabilityFlags, RbacModule, RbacVerb, SessionIdentity } from "@vms/domain";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Capability mirror (M1.3, #22). The server (`GET /me`) authors the 9×5 {@link CapabilityFlags} grid
 * from the same permission set its RBAC guard evaluates; this provider holds that grid for a running
 * app so screens ask `useCan("audit", "view")` and show only affordances the server would honour —
 * a hidden button is exactly a request a guarded route would refuse (401/403).
 *
 * Deny-by-default is preserved on the client: until the grid loads, on any error, and for an
 * anonymous session (the loader returns `null`), every `can()` answers `false`. Nothing is offered
 * that the server hasn't already granted.
 *
 * Stack-neutral, like {@link LocaleProvider}: the app supplies a `load` that knows the API's origin
 * and cookie handling; this package never learns where the API lives.
 *
 * `/me` answers two questions at once — *who* is acting and *what may they do* — so the mirror carries
 * both (M6.5, #90). Before that it kept only the grid and dropped the identity, which is why the
 * console header had no signed-in user to render and showed a hardcoded persona instead.
 */

/**
 * The `/me` mirror: who is signed in, and their capability grid. `null` = no session (an anonymous
 * caller) — identity and grants arrive together or not at all, so there is no state where the app
 * knows a name but not what it may do.
 */
export interface CapabilitiesSnapshot {
  actor: SessionIdentity;
  flags: CapabilityFlags;
}

/** Resolves the current session's mirror, or `null` when there is no session (an anonymous caller). */
export type CapabilitiesLoader = () => Promise<CapabilitiesSnapshot | null>;

/** Where the mirror is in its lifecycle — screens can distinguish "still loading" from "signed out". */
export type CapabilitiesStatus = "loading" | "ready" | "anonymous" | "error";

interface CapabilitiesContextValue {
  status: CapabilitiesStatus;
  /** The live grid once `status === "ready"`, else `null`. */
  flags: CapabilityFlags | null;
  /** Who is signed in, once `status === "ready"`; `null` while loading, anonymous, or on error. */
  actor: SessionIdentity | null;
  /** Deny-by-default check: `true` only when the loaded grid grants `(module, verb)`. */
  can: (module: RbacModule, verb: RbacVerb) => boolean;
  /** Re-fetch the mirror (e.g. after sign-in changes who is acting). */
  reload: () => void;
}

const CapabilitiesContext = createContext<CapabilitiesContextValue | null>(null);

export function CapabilitiesProvider({
  load,
  children,
}: {
  load: CapabilitiesLoader;
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState<CapabilitiesStatus>("loading");
  const [snapshot, setSnapshot] = useState<CapabilitiesSnapshot | null>(null);

  const reload = useCallback(() => {
    let cancelled = false;
    setStatus("loading");
    load()
      .then((mirror) => {
        if (cancelled) return;
        // `null` = no session: stay deny-all, but tell screens it's "signed out", not "still loading".
        setSnapshot(mirror);
        setStatus(mirror ? "ready" : "anonymous");
      })
      .catch(() => {
        if (cancelled) return;
        setSnapshot(null);
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => reload(), [reload]);

  const can = useCallback(
    (module: RbacModule, verb: RbacVerb): boolean => snapshot?.flags?.[module]?.[verb] ?? false,
    [snapshot],
  );

  const value = useMemo<CapabilitiesContextValue>(
    () => ({
      status,
      flags: snapshot?.flags ?? null,
      actor: snapshot?.actor ?? null,
      can,
      reload,
    }),
    [status, snapshot, can, reload],
  );

  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>;
}

function useCapabilitiesContext(): CapabilitiesContextValue {
  const ctx = useContext(CapabilitiesContext);
  if (!ctx) throw new Error("capability hooks must be used within a <CapabilitiesProvider>");
  return ctx;
}

/** `{ status, flags, actor, can, reload }` — the whole mirror, for screens that branch on load state. */
export function useCapabilities(): CapabilitiesContextValue {
  return useCapabilitiesContext();
}

/**
 * Deny-by-default capability check: `useCan("vendors", "add")` is `true` only when the server's grid
 * grants it. `false` while loading, on error, and for an anonymous session — so an affordance is never
 * shown before the server has confirmed the grant behind it.
 */
export function useCan(module: RbacModule, verb: RbacVerb): boolean {
  return useCapabilitiesContext().can(module, verb);
}
