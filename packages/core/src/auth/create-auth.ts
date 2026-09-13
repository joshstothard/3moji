import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth, type BetterAuthOptions } from "better-auth";

import type { DatabaseOrTransaction } from "../db/client";
import { authSchema } from "../db/schema";
import type { Clock } from "../ports/clock";
import type { VerificationDispatchStore } from "../ports/verification-dispatch-store";
import {
  authClientAddressOptions,
  authRateLimitOptions,
} from "./auth-rate-limit";
import type { EmailSender } from "./ports/email-sender";
import { safeDatabaseAdapter } from "./safe-database-adapter";
import { verificationTokenFingerprint } from "./verification-token";

/** Better Auth's own minimum is 32 characters of randomness. */
const MINIMUM_SECRET_LENGTH = 32;

/**
 * Where a verification link points: **our page, not Better Auth's endpoint.**
 *
 * Better Auth's own link is `{baseURL}/api/auth/verify-email?token=…`, which
 * would work and is what the library hands us in `url`. It is not used, for two
 * reasons that only a real run makes obvious:
 *
 * 1. **Invalidation needs an interception point.** The verification token is a
 *    signed JWT the library does not store, so every link it ever issued stays
 *    valid for its hour. "Each resend invalidates the previous link" can only
 *    be enforced by something that runs *before* verification, against our own
 *    record of what we issued — and nothing can run before an endpoint the
 *    library owns.
 * 2. **The endpoint's failure mode loses the token.** Given a `callbackURL`, a
 *    rejected token becomes a redirect to `{callbackURL}?error=token_expired`,
 *    and the token — the only thing that says *whose* link it was — is gone. So
 *    the expired-link page could not say which Handle is still being held,
 *    which is the one thing #82 insists it must say. Given no `callbackURL`, a
 *    rejection is a bare 401 with no page at all.
 *
 * The token still travels as a **query parameter**, matching the shape the
 * library uses; password reset puts its token in a **path segment** instead,
 * and a helper that handles only one of the two shapes passes every
 * verification test and fails every reset test (`quality-strategy.md`).
 */
function verificationLink(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/claim/verify?token=${encodeURIComponent(token)}`;
}

/**
 * Better Auth endpoints that create an Account, **refused over HTTP (#150).**
 *
 * ADR-0004 decision 4: every live Account owns exactly one Handle, so the only
 * way to create one is the Claim, which calls `auth.api.signUpEmail` on the
 * server inside the transaction that writes the hold. Served over HTTP, the
 * same endpoint created an Account with no Handle and sent a verification email
 * from an endpoint nothing limited then — measured against Postgres before this list
 * existed (`direct-sign-up.integration.test.ts`).
 *
 * **Why `disabledPaths` and not `emailAndPassword.disableSignUp`.** Measured,
 * not assumed: `disableSignUp` is checked inside the endpoint's own body, so it
 * refuses the server-side `auth.api.signUpEmail` too and would take the Claim
 * down with the bypass. `disabledPaths` is checked in the router's `onRequest`,
 * which only an HTTP request passes through, and it answers a plain 404 before
 * the body is parsed or the database read — so the refusal is the same bytes,
 * in the same time, whatever address was sent.
 *
 * In better-auth 1.7.4 `internalAdapter.createUser` has exactly two callers:
 * email sign-up, and `handleOAuthUserInfo`, reached from `/sign-in/social` and
 * `/callback/:id`. No social provider is configured, so neither can create an
 * Account today; `/sign-in/social` is listed anyway so the first provider added
 * does not quietly reopen the bypass. `/callback/:id` cannot be listed — the
 * match is on the exact path — and is reachable only with state issued by
 * `/sign-in/social` or `/link-social`, the latter needing a signed-in Account.
 *
 * **The audited facts — versions, callers, plugins and this list — live in
 * `scripts/better-auth-audit.mjs`** (#169), and `npm run test:scripts` fails
 * when the installed tree or this literal stops matching them. The recheck is
 * docs/architecture/auth.md § Rechecking the Account-creation audit.
 */
const HTTP_DISABLED_AUTH_PATHS: readonly string[] = [
  "/sign-up/email",
  "/sign-in/social",
];

export interface CreateAuthInput {
  /**
   * The client, **or a transaction opened on it**. The Claim rebuilds auth
   * against its transaction so that account creation and the Handle's hold are
   * one atomic act (ADR-0004 decision 4); Better Auth's Drizzle adapter issues
   * every statement through whatever it is handed, so handing it a transaction
   * is what puts the `user` and `account` rows inside one.
   */
  readonly db: DatabaseOrTransaction;
  readonly emailSender: EmailSender;
  /**
   * Records every verification link issued.
   *
   * **Passed in, never built from `db` here.** It has to be bound to the same
   * client this instance is — on the claim path that is the transaction — and a
   * store constructed inside this function would be bound correctly for the
   * pooled instance and wrongly for the transactional one, silently, with the
   * row outliving the rollback.
   */
  readonly dispatches: VerificationDispatchStore;
  /** Stamps the dispatch. The same `Clock` the rest of the domain reads. */
  readonly clock: Clock;
  /** Where the app is served from; Better Auth builds its links from this. */
  readonly baseUrl: string;
  /** Signing secret. Passed in; never read from the environment here. */
  readonly secret: string;
  /** The verified sender address used for transactional mail. */
  readonly from: string;
  /**
   * Transport-specific plugins supplied by the application.
   *
   * `apps/web` passes `nextCookies()` here. It cannot be added inside this
   * package: it comes from `better-auth/next-js`, and ADR-0006 decision 2 keeps
   * `packages/core` free of framework imports — a rule its ESLint config
   * enforces. Accepting plugins from the caller is what lets the boundary hold
   * without giving up the plugin.
   */
  readonly plugins?: NonNullable<BetterAuthOptions["plugins"]>;
}

/**
 * Builds the Better Auth instance.
 *
 * Three of these settings are load-bearing for the product rather than
 * defaults worth accepting, and ADR-0006 decision 5 names them:
 *
 * - `requireEmailVerification` makes the verification gate real: sign-up
 *   returns no session and sign-in is refused until the address is confirmed.
 * - `autoSignInAfterVerification` is **not** a default. Without it, following
 *   the verification link verifies the account and then drops the user at a
 *   sign-in page instead of the Profile they just claimed.
 * - `revokeSessionsOnPasswordReset` destroys existing sessions on reset.
 *
 * A successful password reset deliberately does **not** mark the email
 * verified, even though it proves control of the address, so that the claim
 * gate has exactly one meaning (#15).
 */
export function createAuth(input: CreateAuthInput) {
  if (input.secret.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(
      `createAuth requires a secret of at least ${String(MINIMUM_SECRET_LENGTH)} characters. Generate one randomly; a short secret is brute-forceable.`,
    );
  }
  if (input.baseUrl === "") {
    throw new Error(
      "createAuth requires a base URL. Better Auth builds verification and reset links from it, so an empty value produces unusable emails.",
    );
  }

  const { emailSender, from } = input;

  const auth = betterAuth({
    secret: input.secret,
    baseURL: input.baseUrl,
    // Refused over HTTP only; the Claim still calls sign-up server-side (#150).
    disabledPaths: [...HTTP_DISABLED_AUTH_PATHS],
    // Every environment, counted in Postgres (#158). The limiter runs in the
    // router's `onRequest`, after `disabledPaths` and only for HTTP requests,
    // so the Claim's server-side `auth.api.signUpEmail` is never counted.
    rateLimit: authRateLimitOptions(),
    advanced: { ipAddress: authClientAddressOptions() },
    // Wrapped so a failed statement reaches Better Auth — and so its thrown
    // value, its logger and the HTTP route's console output — without the
    // statement's bound values (#148).
    database: safeDatabaseAdapter(
      drizzleAdapter(input.db, {
        provider: "pg",
        schema: authSchema,
      }),
    ),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await emailSender.send({
          to: user.email,
          subject: "Reset your 3moji password",
          // The token travels in the URL only, never the subject: subjects are
          // logged and previewed far more widely than bodies.
          text: `Reset your password: ${url}\n\nIf you did not ask for this, ignore this email and nothing will change.\n\nFrom ${from}`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, token }) => {
        // **Recorded before it is sent, and that order is deliberate.** If the
        // send fails after the row is written, the previous link is dead and no
        // new one arrived — recoverable, because resend is on the hold screen.
        // The other order puts a live link in somebody's inbox that we have no
        // record of, and an unrecorded link is one `finaliseClaim` can only
        // treat as unknown. The recoverable failure is the one to choose.
        await input.dispatches.record({
          userId: user.id,
          tokenHash: verificationTokenFingerprint(token),
          sentAt: input.clock.now(),
        });

        await emailSender.send({
          to: user.email,
          subject: "Verify your email to claim your 3moji handle",
          // The token travels in the URL only, never the subject: subjects are
          // logged, previewed on lock screens and indexed far more widely than
          // bodies.
          text: `Verify your email: ${verificationLink(input.baseUrl, token)}\n\nYour handle is held for 24 hours while you do. After that it returns to the pool.\n\nIf the link has expired by the time you get to it, the page will offer you a new one — your handle is still held.\n\nFrom ${from}`,
        });
      },
    },
    ...(input.plugins === undefined ? {} : { plugins: input.plugins }),
  });

  // **The limiter reads Postgres before any endpoint runs** (#158), in the
  // router's `onRequest`, which better-call does not catch: with the database
  // unreachable, `auth.handler` would reject instead of answering. The value
  // it rejects with is already `DatabaseQueryFailed` — nothing bound, via
  // `safeDatabaseAdapter` — so this only restores the answer every other
  // database failure on this route gets: a bare 500. Fail closed; nothing is
  // admitted. Anything else is rethrown untouched.
  const serve = auth.handler;
  auth.handler = async (request: Request): Promise<Response> => {
    try {
      return await serve(request);
    } catch (error) {
      if (isDatabaseQueryFailed(error)) {
        return new Response("Internal Server Error", { status: 500 });
      }
      throw error;
    }
  };

  return auth;
}

/**
 * Read by name, not `instanceof`: `--experimental-vm-modules` runs ESM in a
 * realm of its own, where an `instanceof` check silently fails.
 */
function isDatabaseQueryFailed(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "DatabaseQueryFailed"
  );
}
