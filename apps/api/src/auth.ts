/**
 * Authentication (M1.1, #20, ADR-0004/0015) — better-auth on Bun + Hono.
 *
 * One `users` table with a `kind` discriminator (ADR-0004): the public sign-up path is for vendors
 * (portal), internal users are created by staff (M1.2 seed / M1.5 admin). Portal vs console is
 * authorization (RBAC), not separate auth stacks — both audiences authenticate here.
 *
 * The Drizzle adapter is pointed at the companion tables already in `@vms/db` (`users`,
 * `auth_sessions`, `auth_accounts`, `auth_verifications`), keyed by better-auth's singular model
 * names. Two schema reconciliations: better-auth's `password` field maps to our `passwordHash`
 * column, and `kind` is injected as a non-input field defaulting to `vendor` so a public sign-up
 * always yields a vendor without the client choosing its own kind.
 *
 * Email verification and password reset are required and go through the SMTP seam (`./email`,
 * Mailpit in dev). The session this produces is read back per-request by {@link sessionActorResolver}
 * to build the domain `Actor`.
 */

import {
  authAccounts,
  authSessions,
  authVerifications,
  db,
  roles,
  userRoles,
  users,
} from "@vms/db";
import { type Locale, resolveLocale } from "@vms/domain";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { type AuditAttribution, type AuditEntry, writeAuditRow } from "./audit";
import { sendPasswordResetEmail, sendVerificationEmail } from "./email";
import { env } from "./env";

/**
 * Record an auth mutation in the audit trail (M1.4, ADR-0011). Registration and each sign-in are the
 * only mutations that exist before feature work (M2+), and better-auth owns their write — so unlike a
 * domain mutation (which shares its transaction with {@link writeAudit}), this runs post-hoc and is
 * **best-effort**: a failed audit write is logged but never allowed to break the login it describes.
 */
const recordAuthEvent = async (attribution: AuditAttribution, entry: AuditEntry): Promise<void> => {
  try {
    await writeAuditRow(db, attribution, entry);
  } catch (error) {
    console.error("[audit] failed to record auth event", entry.action, error);
  }
};

/**
 * Grant a freshly self-registered user the **`vendor`** role (M3.5, #46, ADR-0004). Public sign-up is
 * the vendor path (`kind` is forced to `vendor` below), but better-auth only writes the `users` row — it
 * never assigns a role, so without this a self-registered vendor resolves an empty (deny-all) permission
 * set and the portal 403s every capture call. Idempotent (the `user_roles` unique index) and best-effort
 * so an assignment hiccup is logged, never allowed to break the account creation it follows.
 */
const assignVendorRole = async (userId: string): Promise<void> => {
  try {
    const [vendorRole] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, "vendor"))
      .limit(1);
    if (!vendorRole) {
      console.error("[auth] vendor role not seeded — new vendor has no permissions", userId);
      return;
    }
    await db.insert(userRoles).values({ userId, roleId: vendorRole.id }).onConflictDoNothing();
  } catch (error) {
    console.error("[auth] failed to assign vendor role", userId, error);
  }
};

/** Best-effort locale for a transactional email: `?lang` → `locale` cookie → `Accept-Language` → id. */
const localeFromRequest = (request?: Request): Locale => {
  if (!request) return "id";
  const url = new URL(request.url);
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim().split("="))
    .find(([k]) => k === "locale")?.[1];
  const header = request.headers.get("accept-language")?.split(",")[0]?.split("-")[0]?.trim();
  return resolveLocale(url.searchParams.get("lang") ?? cookie ?? header);
};

export const auth = betterAuth({
  appName: "Soechi VMS",
  secret: env.betterAuthSecret,
  baseURL: env.betterAuthUrl,
  basePath: "/api/auth",
  trustedOrigins: env.corsOrigins,

  database: drizzleAdapter(db, {
    provider: "pg",
    // Keyed by better-auth's singular model names → our (differently-named) Drizzle tables.
    schema: {
      user: users,
      session: authSessions,
      account: authAccounts,
      verification: authVerifications,
    },
  }),

  // Our PKs are Postgres `uuid` columns. better-auth's default id generator emits opaque
  // non-UUID strings, which the uuid columns reject — so have it mint real UUIDs instead.
  advanced: { database: { generateId: "uuid" } },

  // better-auth's account `password` field lives in our `passwordHash` column.
  account: { fields: { password: "passwordHash" } },

  // `kind` is NOT NULL with no DB default; force it server-side so a public sign-up is always a
  // vendor and the client can never set it. Internal users are created outside this flow with kind set.
  user: {
    additionalFields: {
      kind: {
        type: "string",
        required: true,
        input: false,
        defaultValue: "vendor",
        returned: true,
      },
    },
  },

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true, // no session until the email is verified (ADR-0004)
    minPasswordLength: 8,
    autoSignIn: true,
    sendResetPassword: async ({ user, url }, request) => {
      await sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        url,
        locale: localeFromRequest(request),
      });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60, // 1 hour, mirrored by the email copy
    sendVerificationEmail: async ({ user, url }, request) => {
      await sendVerificationEmail({
        to: user.email,
        name: user.name,
        url,
        locale: localeFromRequest(request),
      });
    },
  },

  // Audit the auth mutations (M1.4, ADR-0011): a user row created → `user.registered`, a session
  // created → `user.signed_in`. Each is attributed to the acting user (the new account signs itself
  // up; the session belongs to whoever just logged in) and stamped with the request's ip / user-agent
  // where better-auth captured it on the session. Best-effort so an audit hiccup never blocks auth.
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Public sign-up = a vendor account: grant the `vendor` role so the new owner can actually
          // capture their registration (ADR-0004). Internal users are created outside this flow.
          await assignVendorRole(user.id);
          await recordAuthEvent(
            { actorUserId: user.id },
            { action: "user.registered", subjectType: "user", subjectId: user.id },
          );
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          await recordAuthEvent(
            {
              actorUserId: session.userId,
              ip: session.ipAddress ?? undefined,
              userAgent: session.userAgent ?? undefined,
            },
            { action: "user.signed_in", subjectType: "user", subjectId: session.userId },
          );
        },
      },
    },
  },
});

export type Auth = typeof auth;
