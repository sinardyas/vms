/**
 * Own-vendor scoping for the portal (M3.5, #46, ADR-0004/0012).
 *
 * RBAC answers *"may this actor touch the `vendors` module?"*; it does **not** answer *"may this actor
 * touch **this** vendor?"*. A self-registering vendor holds `vendors:add/edit/view` on the module, which
 * would otherwise let them read or edit **any** vendor's banks/documents by guessing an id. This guard
 * closes that gap — the row-level scoping the M1.2 access seed deliberately left to enforcement.
 *
 * The rule is by actor **kind** (ADR-0004 — portal vs console is authorization, one auth stack):
 *   - **internal** staff (console, M3.6/M4/M5) act across vendors, bounded only by RBAC — bypass here.
 *   - **vendor** users may reach a `:vendorId` only if they are a member of it (`vendor_sub_users`).
 * A vendor reaching someone else's record gets 403 `error.vendor.notOwner` (no existence leak — the
 * same answer whether the id is a stranger's or a typo). An unauthenticated request is left for the
 * downstream `requirePermission` to turn into a 401, so the permission check owns that signal.
 *
 * Mounted in `index.ts` over the bank + document sub-routers (their `:vendorId` paths), and reused as a
 * per-route guard by the vendor aggregate route. The membership store is injectable so the middleware is
 * testable without Postgres; the default is the real Drizzle lookup.
 */

import { db as defaultDb, vendorSubUsers } from "@vms/db";
import { forbiddenError } from "@vms/domain";
import { and, eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./context";
import { sendError } from "./http-error";

/** The one DB touch the guard needs — is `userId` a member of `vendorId`? Faked in tests. */
export type VendorMembershipStore = {
  readonly isMember: (vendorId: string, userId: string) => Promise<boolean>;
  /** Which vendor (if any) this user owns — the portal's "resume my registration" lookup. */
  readonly ownedVendorId: (userId: string) => Promise<string | null>;
};

export const drizzleVendorMembershipStore = (dbHandle = defaultDb): VendorMembershipStore => ({
  isMember: async (vendorId, userId) => {
    const [row] = await dbHandle
      .select({ id: vendorSubUsers.id })
      .from(vendorSubUsers)
      .where(and(eq(vendorSubUsers.vendorId, vendorId), eq(vendorSubUsers.userId, userId)))
      .limit(1);
    return row !== undefined;
  },
  ownedVendorId: async (userId) => {
    const [row] = await dbHandle
      .select({ vendorId: vendorSubUsers.vendorId })
      .from(vendorSubUsers)
      .where(and(eq(vendorSubUsers.userId, userId), eq(vendorSubUsers.isOwner, true)))
      .limit(1);
    return row?.vendorId ?? null;
  },
});

/**
 * Middleware: constrain a vendor-kind actor to a vendor they belong to. Internal actors and
 * unauthenticated requests pass through (RBAC / the 401 guard handle those); a vendor accessing a
 * `:vendorId` they aren't a member of is refused 403. Reads the `vendorId` path param, so mount it only
 * on routes that carry one.
 */
export const requireVendorOwnership =
  (store: VendorMembershipStore = drizzleVendorMembershipStore()): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const { actor } = c.var.ctx;
    // Let `requirePermission` own the 401; let internal staff act cross-vendor (bounded by RBAC).
    if (!actor || actor.kind !== "vendor") return next();
    const vendorId = c.req.param("vendorId");
    if (!vendorId) return next();
    if (await store.isMember(vendorId, actor.userId)) return next();
    return sendError(c, forbiddenError({ messageKey: "error.vendor.notOwner" }));
  };
