/**
 * Console Access admin (M1.5, #24, ADR-0011/0012) — Users CRUD, Roles CRUD (+ lead), and the RBAC
 * matrix editor, guarded on the `access` module.
 *
 * Every mutation runs inside a transaction that ends with the **deadlock guard** (ADR-0011b): after
 * the change is applied, it counts the active users who would still hold each critical approval
 * permission (`approvals:approve`, `documents:approve`); if a save strands one at zero holders it is
 * rolled back and returned as a warning the client can re-submit with `confirm: true`. So no matrix
 * edit, role deactivation, or role-unassignment can silently make a seeded workflow un-approvable.
 *
 * Data access is behind {@link AccessStore} so the route's orchestration (guards, validation, warning
 * mapping) is unit-testable without Postgres or better-auth; the default store is the real Drizzle +
 * better-auth implementation. New internal users are created directly on the `users` table (the public
 * sign-up path forces `kind: vendor`); their credential is provisioned when they follow the emailed
 * password-reset link (better-auth creates it on first set), so no temporary password is ever stored.
 */

import { type DB, db as defaultDb, rolePermissions, roles, userRoles, users } from "@vms/db";
import {
  type Permission,
  type RequestContext,
  type Result,
  conflictError,
  err,
  invariantError,
  isErr,
  mayGrantRoles,
  notFoundError,
  parseWith,
  permissionKey,
  validationError,
} from "@vms/domain";
import { and, countDistinct, eq, inArray } from "drizzle-orm";
import { type Context, Hono } from "hono";
import type { ZodType } from "zod";
import {
  CRITICAL_CAPABILITIES,
  type CreateRoleInput,
  type CreateUserInput,
  type CriticalHolders,
  type RoleDTO,
  type UpdateRoleInput,
  type UpdateUserInput,
  type UserDTO,
  createRoleSchema,
  createUserSchema,
  formatCapabilities,
  matrixFromRows,
  matrixToRows,
  strandedCapabilities,
  updateRoleSchema,
  updateUserSchema,
} from "./access-service";
import { type AuditEntry, writeAudit } from "./audit";
import { auth } from "./auth";
import type { AppEnv } from "./context";
import { env } from "./env";
import { sendError } from "./http-error";
import { requirePermission } from "./rbac";

/** A mutation outcome: applied (`value`), stranded by the deadlock guard (`deadlock`), or not found. */
export type MutationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly deadlock: readonly Permission[] };

/** The route's data-access seam — every DB + better-auth touch, so the router is testable with a fake. */
export type AccessStore = {
  readonly listRoles: () => Promise<RoleDTO[]>;
  readonly createRole: (
    ctx: RequestContext,
    input: CreateRoleInput,
  ) => Promise<MutationResult<RoleDTO> | { readonly ok: false; readonly conflict: true }>;
  readonly updateRole: (
    ctx: RequestContext,
    id: string,
    patch: UpdateRoleInput,
  ) => Promise<MutationResult<RoleDTO> | null>;
  readonly deactivateRole: (
    ctx: RequestContext,
    id: string,
  ) => Promise<MutationResult<RoleDTO> | null>;
  readonly listUsers: () => Promise<UserDTO[]>;
  readonly createUser: (
    ctx: RequestContext,
    input: CreateUserInput,
  ) => Promise<
    { readonly ok: true; readonly value: UserDTO } | { readonly ok: false; readonly conflict: true }
  >;
  /** `vendorGrant` = the patch would grant roles to a vendor-kind user (#96) — refused, nothing written. */
  readonly updateUser: (
    ctx: RequestContext,
    id: string,
    patch: UpdateUserInput,
  ) => Promise<MutationResult<UserDTO> | { readonly ok: false; readonly vendorGrant: true } | null>;
  readonly resetPassword: (ctx: RequestContext, id: string) => Promise<{ email: string } | null>;
  readonly eligibility: () => Promise<CriticalHolders[]>;
};

/** Thrown inside a transaction to roll it back when the deadlock guard trips without confirmation. */
class DeadlockRollback extends Error {
  constructor(readonly zeroed: Permission[]) {
    super("deadlock");
  }
}

/** The two modules the critical capabilities live on — the ones the holder-count query scopes to. */
const CRITICAL_MODULES = CRITICAL_CAPABILITIES.map((c) => c.module);

/**
 * Count the active users holding each critical approval capability, through their active roles.
 * `exec` is the ambient `db` or an open transaction, so the guard sees the *post-change* state.
 */
const countCriticalHolders = async (exec: Pick<DB, "select">): Promise<Record<string, number>> => {
  const rows = await exec
    .select({ module: rolePermissions.module, holders: countDistinct(users.id) })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, and(eq(roles.id, userRoles.roleId), eq(roles.active, true)))
    .innerJoin(
      rolePermissions,
      and(eq(rolePermissions.roleId, roles.id), eq(rolePermissions.canApprove, true)),
    )
    .where(and(eq(users.active, true), inArray(rolePermissions.module, CRITICAL_MODULES)))
    .groupBy(rolePermissions.module);

  const counts: Record<string, number> = {};
  for (const cap of CRITICAL_CAPABILITIES) counts[permissionKey(cap.module, cap.verb)] = 0;
  for (const row of rows) counts[permissionKey(row.module, "approve")] = Number(row.holders);
  return counts;
};

/** Re-read one role and assemble its DTO (matrix + active-user count). Returns null if it vanished. */
const readRole = async (exec: Pick<DB, "select">, id: string): Promise<RoleDTO | null> => {
  const [role] = await exec.select().from(roles).where(eq(roles.id, id)).limit(1);
  if (!role) return null;
  const perms = await exec.select().from(rolePermissions).where(eq(rolePermissions.roleId, id));
  const [count] = await exec
    .select({ n: countDistinct(users.id) })
    .from(userRoles)
    .innerJoin(users, and(eq(users.id, userRoles.userId), eq(users.active, true)))
    .where(eq(userRoles.roleId, id));
  return {
    id: role.id,
    code: role.code,
    nameId: role.nameId,
    nameEn: role.nameEn,
    active: role.active,
    leadUserId: role.leadUserId,
    userCount: Number(count?.n ?? 0),
    matrix: matrixFromRows(perms),
  };
};

/** Re-read one user and assemble its DTO (with role refs). Returns null if it vanished. */
const readUser = async (exec: Pick<DB, "select">, id: string): Promise<UserDTO | null> => {
  const [user] = await exec.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) return null;
  const refs = await exec
    .select({ id: roles.id, code: roles.code, nameId: roles.nameId, nameEn: roles.nameEn })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, id));
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    kind: user.kind,
    active: user.active,
    roles: refs,
  };
};

/** The real store: Drizzle for the data, better-auth for credential provisioning + reset emails. */
export const drizzleAccessStore = (db: DB = defaultDb): AccessStore => {
  /**
   * Run `apply` inside a transaction, then the deadlock guard: if applying it strands a critical
   * capability and `confirm` is false, roll back and report the stranded set; else commit (writing
   * the audit row atomically via the passed sink). Returns the applied value or the deadlock.
   */
  const guarded = async <T>(
    confirm: boolean,
    apply: (tx: DB) => Promise<{ value: T; audit: AuditEntry }>,
    ctx: RequestContext,
  ): Promise<MutationResult<T>> => {
    try {
      const value = await db.transaction(async (txHandle) => {
        const tx = txHandle as unknown as DB;
        // Capture the pre-change holder counts first, then apply and re-count: a delta guard warns
        // only when this save strands the *last* holder, never during greenfield setup (ADR-0011b).
        const before = await countCriticalHolders(tx);
        const { value, audit } = await apply(tx);
        const stranded = strandedCapabilities(before, await countCriticalHolders(tx));
        if (stranded.length > 0 && !confirm) throw new DeadlockRollback(stranded);
        await writeAudit(txHandle, ctx, audit);
        return value;
      });
      return { ok: true, value };
    } catch (error) {
      if (error instanceof DeadlockRollback) return { ok: false, deadlock: error.zeroed };
      throw error;
    }
  };

  return {
    listRoles: async () => {
      const all = await db.select().from(roles).orderBy(roles.code);
      return Promise.all(all.map((r) => readRole(db, r.id) as Promise<RoleDTO>));
    },

    createRole: async (ctx, input) => {
      const [existing] = await db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.code, input.code))
        .limit(1);
      if (existing) return { ok: false, conflict: true };

      return guarded(
        input.confirm ?? false,
        async (tx) => {
          const [role] = await tx
            .insert(roles)
            .values({
              code: input.code,
              nameId: input.nameId,
              nameEn: input.nameEn,
              leadUserId: input.leadUserId ?? null,
            })
            .returning({ id: roles.id });
          if (!role) throw new Error("role insert returned no row");
          await tx
            .insert(rolePermissions)
            .values(matrixToRows(input.matrix).map((row) => ({ roleId: role.id, ...row })));
          const value = (await readRole(tx, role.id)) as RoleDTO;
          return {
            value,
            audit: {
              action: "role.created",
              module: "access",
              subjectType: "role",
              subjectId: role.id,
            },
          };
        },
        ctx,
      );
    },

    updateRole: async (ctx, id, patch) => {
      const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.id, id)).limit(1);
      if (!role) return null;

      return guarded(
        patch.confirm ?? false,
        async (tx) => {
          const set: Record<string, unknown> = { updatedAt: new Date() };
          if (patch.nameId !== undefined) set.nameId = patch.nameId;
          if (patch.nameEn !== undefined) set.nameEn = patch.nameEn;
          if (patch.leadUserId !== undefined) set.leadUserId = patch.leadUserId ?? null;
          if (patch.active !== undefined) set.active = patch.active;
          await tx.update(roles).set(set).where(eq(roles.id, id));

          if (patch.matrix) {
            // Replace the grid wholesale: the editor sends the full 9×5, so a delete-then-insert is
            // the simplest correct upsert of every module row.
            await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
            await tx
              .insert(rolePermissions)
              .values(matrixToRows(patch.matrix).map((row) => ({ roleId: id, ...row })));
          }
          const value = (await readRole(tx, id)) as RoleDTO;
          return {
            value,
            audit: { action: "role.updated", module: "access", subjectType: "role", subjectId: id },
          };
        },
        ctx,
      );
    },

    deactivateRole: async (ctx, id) => {
      const [role] = await db
        .select({ active: roles.active })
        .from(roles)
        .where(eq(roles.id, id))
        .limit(1);
      if (!role) return null;
      // Deactivation is guarded but never confirm-forced here: a role whose loss deadlocks the
      // workflow must be re-confirmed via the edit path, which carries `confirm`.
      return guarded(
        false,
        async (tx) => {
          await tx
            .update(roles)
            .set({ active: false, updatedAt: new Date() })
            .where(eq(roles.id, id));
          const value = (await readRole(tx, id)) as RoleDTO;
          return {
            value,
            audit: {
              action: "role.deactivated",
              module: "access",
              subjectType: "role",
              subjectId: id,
            },
          };
        },
        ctx,
      );
    },

    listUsers: async () => {
      const all = await db.select({ id: users.id }).from(users).orderBy(users.email);
      return Promise.all(all.map((u) => readUser(db, u.id) as Promise<UserDTO>));
    },

    createUser: async (ctx, input) => {
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);
      if (existing) return { ok: false, conflict: true };

      // Create the internal user directly (public sign-up hard-codes kind: vendor). Verified: an admin
      // vouches for the address, and the reset link they follow proves control of it.
      const [row] = await db
        .insert(users)
        .values({ kind: "internal", email: input.email, name: input.name, emailVerified: true })
        .returning({ id: users.id });
      if (!row) throw new Error("user insert returned no row");

      const roleIds = input.roleIds ?? [];
      if (roleIds.length > 0) {
        await db
          .insert(userRoles)
          .values(roleIds.map((roleId) => ({ userId: row.id, roleId })))
          .onConflictDoNothing();
      }
      await writeAudit(db, ctx, {
        action: "user.created",
        module: "access",
        subjectType: "user",
        subjectId: row.id,
      });

      // Provision the credential by inviting them to set a password. Best-effort: the account exists
      // regardless, and an admin can re-send the reset from the UI if the mail transport hiccuped.
      await requestPasswordSet(input.email).catch(() => undefined);

      const value = (await readUser(db, row.id)) as UserDTO;
      return { ok: true, value };
    },

    updateUser: async (ctx, id, patch) => {
      const [user] = await db
        .select({ id: users.id, kind: users.kind })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      if (!user) return null;

      // Roles are administered on internal users only (#96). Checked before the transaction opens, so
      // a refused patch writes nothing at all — not the role rows, not the name/active fields riding
      // with them. Only role-bearing patches are refused: renaming or deactivating a vendor user is
      // ordinary admin work and stays open.
      if (patch.roleIds && !mayGrantRoles(user)) return { ok: false, vendorGrant: true };

      return guarded(
        patch.confirm ?? false,
        async (tx) => {
          const set: Record<string, unknown> = { updatedAt: new Date() };
          if (patch.name !== undefined) set.name = patch.name;
          if (patch.active !== undefined) set.active = patch.active;
          if (patch.name !== undefined || patch.active !== undefined) {
            await tx.update(users).set(set).where(eq(users.id, id));
          }
          if (patch.roleIds) {
            await tx.delete(userRoles).where(eq(userRoles.userId, id));
            if (patch.roleIds.length > 0) {
              await tx
                .insert(userRoles)
                .values(patch.roleIds.map((roleId) => ({ userId: id, roleId })))
                .onConflictDoNothing();
            }
          }
          const action =
            patch.active === false
              ? "user.deactivated"
              : patch.active === true
                ? "user.reactivated"
                : "user.updated";
          const value = (await readUser(tx, id)) as UserDTO;
          return {
            value,
            audit: { action, module: "access" as const, subjectType: "user", subjectId: id },
          };
        },
        ctx,
      );
    },

    resetPassword: async (ctx, id) => {
      const [user] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      if (!user) return null;
      await requestPasswordSet(user.email);
      await writeAudit(db, ctx, {
        action: "user.password_reset",
        module: "access",
        subjectType: "user",
        subjectId: id,
      });
      return { email: user.email };
    },

    eligibility: async () => {
      const counts = await countCriticalHolders(db);
      return CRITICAL_CAPABILITIES.map((cap) => ({
        module: cap.module,
        verb: cap.verb,
        holders: counts[permissionKey(cap.module, cap.verb)] ?? 0,
      }));
    },
  };
};

/** Send the "set your password" email (better-auth provisions the credential on first set). */
const requestPasswordSet = (email: string): Promise<unknown> =>
  auth.api.requestPasswordReset({
    body: { email, redirectTo: `${env.consoleUrl}/reset-password` },
  });

/** Read + validate a JSON body against `schema`, as a domain `Result` (never throws). */
const readBody = async <T>(c: Context<AppEnv>, schema: ZodType<T>): Promise<Result<T>> => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return err(validationError());
  }
  return parseWith(schema, raw);
};

/**
 * Build the `/access` router. Mount under a parent that runs the request-context middleware so
 * `c.var.ctx` is populated before the guards. Pass a fake store in tests.
 */
export const accessRoutes = (store: AccessStore = drizzleAccessStore()) => {
  const app = new Hono<AppEnv>();

  // --- Roles ---
  app.get("/roles", requirePermission("access", "view"), async (c) =>
    c.json({ roles: await store.listRoles() }),
  );

  app.post("/roles", requirePermission("access", "add"), async (c) => {
    const body = await readBody<CreateRoleInput>(c, createRoleSchema);
    if (isErr(body)) return sendError(c, body.error);
    const result = await store.createRole(c.var.ctx, body.value);
    if ("conflict" in result)
      return sendError(c, conflictError({ messageKey: "access.error.codeTaken" }));
    if (!result.ok) return deadlock(c, result.deadlock);
    return c.json({ role: result.value }, 201);
  });

  app.patch("/roles/:id", requirePermission("access", "edit"), async (c) => {
    const body = await readBody<UpdateRoleInput>(c, updateRoleSchema);
    if (isErr(body)) return sendError(c, body.error);
    const result = await store.updateRole(c.var.ctx, c.req.param("id"), body.value);
    if (result === null)
      return sendError(c, notFoundError({ messageKey: "access.error.notFound" }));
    if (!result.ok) return deadlock(c, result.deadlock);
    return c.json({ role: result.value });
  });

  app.delete("/roles/:id", requirePermission("access", "delete"), async (c) => {
    const result = await store.deactivateRole(c.var.ctx, c.req.param("id"));
    if (result === null)
      return sendError(c, notFoundError({ messageKey: "access.error.notFound" }));
    if (!result.ok) return deadlock(c, result.deadlock);
    return c.json({ role: result.value });
  });

  // --- Users ---
  app.get("/users", requirePermission("access", "view"), async (c) =>
    c.json({ users: await store.listUsers() }),
  );

  app.post("/users", requirePermission("access", "add"), async (c) => {
    const body = await readBody<CreateUserInput>(c, createUserSchema);
    if (isErr(body)) return sendError(c, body.error);
    const result = await store.createUser(c.var.ctx, body.value);
    if (!result.ok) return sendError(c, conflictError({ messageKey: "access.error.emailTaken" }));
    return c.json({ user: result.value }, 201);
  });

  app.patch("/users/:id", requirePermission("access", "edit"), async (c) => {
    const body = await readBody<UpdateUserInput>(c, updateUserSchema);
    if (isErr(body)) return sendError(c, body.error);
    const result = await store.updateUser(c.var.ctx, c.req.param("id"), body.value);
    if (result === null)
      return sendError(c, notFoundError({ messageKey: "access.error.notFound" }));
    if ("vendorGrant" in result)
      return sendError(c, invariantError({ messageKey: "access.error.vendorRoleGrant" }));
    if (!result.ok) return deadlock(c, result.deadlock);
    return c.json({ user: result.value });
  });

  app.post("/users/:id/reset-password", requirePermission("access", "edit"), async (c) => {
    const result = await store.resetPassword(c.var.ctx, c.req.param("id"));
    if (result === null)
      return sendError(c, notFoundError({ messageKey: "access.error.notFound" }));
    return c.json({ ok: true, email: result.email });
  });

  // --- Eligibility (the deadlock-guard context the matrix editor shows) ---
  app.get("/eligibility", requirePermission("access", "view"), async (c) =>
    c.json({ critical: await store.eligibility() }),
  );

  return app;
};

/** Map a stranded critical-capability set to the localized, re-confirmable deadlock warning (422). */
const deadlock = (c: Context<AppEnv>, zeroed: readonly Permission[]) =>
  sendError(
    c,
    invariantError({
      messageKey: "access.deadlock.warning",
      params: { capabilities: formatCapabilities(zeroed) },
    }),
  );
