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
  vendorSubUsers,
  vendors,
} from "@vms/db";
import { type Locale, resolveLocale } from "@vms/domain";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, eq } from "drizzle-orm";
import { type AuditAttribution, type AuditEntry, writeAuditRow } from "./audit";
import {
  VERIFY_REDIRECT,
  isOfficeInviteLink,
  officeInviteRedirect,
  withCallbackURL,
} from "./credential-links";
import { sendPasswordResetEmail } from "./email";
import { env } from "./env";
import { notify } from "./notifications";

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

/**
 * Remember the language a user signed up in (M6.2, #78) — `users.locale`.
 *
 * M6.1 added the column with a default of `id` and noted that **nothing captured the preference**;
 * this is that capture. It matters more than it looks: `notify()` renders in the *recipient's*
 * locale, so without a stored preference every notification a vendor ever receives would be
 * Indonesian, no matter that they signed up in English. Re-pointing the verify mail through the
 * service (below) would then have been a *regression* — M1.1 honoured the request's `?lang` — and
 * stamping it here is precisely what makes the re-point behaviour-preserving instead.
 *
 * Best-effort: a failed stamp costs the user a language preference, not their account, so it's
 * logged and swallowed rather than allowed to break the sign-up it follows.
 */
const stampLocale = async (userId: string, locale: Locale): Promise<void> => {
  try {
    await db.update(users).set({ locale }).where(eq(users.id, userId));
  } catch (error) {
    console.error("[auth] failed to stamp locale", userId, error);
  }
};

/**
 * Confirm the address a credential link was mailed to (M6.5d, #92).
 *
 * Following a link sent to an inbox proves control of that inbox — it is the same evidence the
 * verification link collects, arriving by the same post. So consuming a reset token verifies the
 * address, and an office owner (provisioned `emailVerified: false` precisely so the invite could be
 * the proof — see `office-account.ts`) becomes verified by acting on their invitation.
 *
 * Without this the invitation is a trap: the owner sets a password and then cannot sign in, because
 * `requireEmailVerification` refuses an unverified address and *no* second mail is ever sent to fix
 * it. The account would be permanently unreachable through the only door it has.
 *
 * Idempotent and harmless for the already-verified (a staff reset, a vendor who forgot their
 * password) — they are simply re-asserted as verified. Best-effort: the password has already been
 * changed by the time this runs, so a failure here must not fail the reset it follows.
 */
const confirmEmailOnReset = async (userId: string): Promise<void> => {
  try {
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, userId));
  } catch (error) {
    console.error("[auth] failed to confirm email on password reset", userId, error);
  }
};

/** The vendor a newly provisioned office owner belongs to — `null` if they own none. */
const officeInviteFor = async (userId: string): Promise<{ vendorName: string } | null> => {
  const [row] = await db
    .select({ vendorName: vendors.name })
    .from(vendorSubUsers)
    .innerJoin(vendors, eq(vendors.id, vendorSubUsers.vendorId))
    .where(and(eq(vendorSubUsers.userId, userId), eq(vendorSubUsers.isOwner, true)))
    .limit(1);
  return row ?? null;
};

/**
 * Send an office-registered vendor's owner their invitation: a link that sets their first password
 * (M6.2, ADR-0004). better-auth has no "mint a token without mailing it" API — `requestPasswordReset`
 * always routes through `sendResetPassword` — so the invite is delivered *from* that callback, which
 * recognises the link by {@link officeInviteRedirect}. Best-effort, like every notification: the
 * activation it follows has already committed.
 */
export const sendOfficeInvite = async (email: string): Promise<void> => {
  try {
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: officeInviteRedirect(email) },
    });
  } catch (error) {
    console.error("[auth] failed to send office invite", email, error);
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
      // An office vendor's activation provisions their account and then asks better-auth for a
      // password-set token, which arrives here as `url` (M6.2). That is the *only* link that lets the
      // owner into the portal, so it must ride the invite email rather than a second, generic
      // "reset your password" one the vendor never asked for — hence the branch. The signal is the
      // `redirectTo` we passed on the way in, so this stays stateless: nothing is remembered between
      // the request and this callback.
      if (isOfficeInviteLink(url)) {
        const invited = await officeInviteFor(user.id);
        if (invited) {
          await notify({
            to: user.id,
            event: "office_invite",
            params: { url, vendorName: invited.vendorName },
          });
          return;
        }
        // The link was minted for an invite but the vendor link has vanished — fall through to the
        // plain reset mail rather than swallowing the only credential link the user will get.
        console.error(
          "[auth] office-invite link with no owned vendor; sending plain reset",
          user.id,
        );
      }
      await sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        url,
        locale: localeFromRequest(request),
      });
    },
    // Consuming a token we mailed proves control of the address it went to (M6.5d) — which is what
    // lets an office owner sign in with the password they just set, rather than bouncing off
    // `requireEmailVerification` on an address no further mail would ever verify.
    onPasswordReset: async ({ user }) => {
      await confirmEmailOnReset(user.id);
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60, // 1 hour, mirrored by the email copy
    sendVerificationEmail: async ({ user, url }, request) => {
      // Re-pointed onto the M6.1 service (M6.2 DoD). The copy is unchanged — the `email_verify`
      // template reuses M1.1's own `auth.email.verify.*` keys, so the two *cannot* drift — but the
      // mail now goes out through the one dispatcher every Phase-0 event shares.
      //
      // The stamp has to land first: `notify()` renders from `users.locale`, so the row must already
      // carry the language this request asked for or the verify mail regresses to Indonesian. This is
      // the sign-up request (`sendOnSignUp`), which is exactly where the preference is knowable.
      await stampLocale(user.id, localeFromRequest(request));
      // Steer the link at the portal's landing page (M6.5d, #92). better-auth builds it to return to
      // *its own* root — an API health blob — unless the sign-up caller passed a `callbackURL`, which
      // is a thing a client can simply forget. Overwriting it here makes the destination the server's
      // decision, so every verification mail lands somewhere a person can read.
      await notify({
        to: user.id,
        event: "email_verify",
        params: { url: withCallbackURL(url, VERIFY_REDIRECT) },
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
