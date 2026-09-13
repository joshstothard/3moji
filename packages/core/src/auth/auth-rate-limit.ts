/**
 * **This module imports nothing**, Better Auth's types included. That keeps
 * it outside `scripts/better-auth-audit.mjs`'s list of modules that import
 * Better Auth (#169) — it adds no endpoint and no plugin — and lets the web
 * app's test read `CLIENT_ADDRESS_HEADERS` from source. The option shapes
 * below are checked against Better Auth where `createAuth` passes them.
 */

/**
 * One Better Auth rate-limit rule: at most `max` requests from one client to
 * one path, with `window` in **seconds** — Better Auth's unit, not ours. The
 * counter resets once `window` has passed since the last admitted request, and
 * each admitted request moves that point on: neither fixed nor rolling.
 */
export interface AuthRateLimit {
  readonly window: number;
  readonly max: number;
}

/**
 * How often Better Auth's own HTTP endpoints answer one client
 * ([#158](https://github.com/joshstothard/3moji/issues/158)).
 *
 * **Starting values to tune, not principles** — an open question from
 * planning, flagged for the repo owner on the pull request that introduced
 * them.
 *
 * - **`default`** is Better Auth's own default (100 in 10 seconds), stated so
 *   that nothing about the limit is implicit. It covers every path below that
 *   has no rule of its own — sign-out, the session read, verify-email.
 * - **Sign-in: 10 in 15 minutes.** Enough for somebody who has forgotten which
 *   password they used; far too few to guess one. A wrong password and an
 *   unknown address are both 401, so the limit reveals nothing either.
 * - **Password reset and send-verification: 5 an hour.** Both send email to
 *   an address the caller chooses, so this is what bounds how much mail one
 *   client can make us send to somebody else. The resend button on the hold
 *   screen does not come through here — see `resend-rate-limit.ts`.
 *
 * **Why not Better Auth's built-in rules**, which apply the moment limiting is
 * on (`/sign-in*` 3 in 10 s; the two email paths 3 a minute, in better-auth
 * 1.7.4): they are unnamed, undocumented here and change with upgrades. These
 * replace them with values that are ours. None is 3, so a test at the boundary
 * proves our rule is the one in force rather than the built-in one.
 */
export interface AuthRateLimits {
  readonly default: AuthRateLimit;
  readonly signInEmail: AuthRateLimit;
  readonly requestPasswordReset: AuthRateLimit;
  readonly sendVerificationEmail: AuthRateLimit;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;

export const AUTH_RATE_LIMITS: AuthRateLimits = {
  default: { window: 10, max: 100 },
  signInEmail: { window: 15 * MINUTE, max: 10 },
  requestPasswordReset: { window: HOUR, max: 5 },
  sendVerificationEmail: { window: HOUR, max: 5 },
};

/**
 * The model, and so the table, Better Auth counts in. Snake case beside
 * `claim_rate_limit`; Better Auth addresses it through this name, so the key in
 * `authSchema` must match it (`schema.test.ts` asserts it does).
 */
export const AUTH_RATE_LIMIT_MODEL = "auth_rate_limit";

/** The part of Better Auth's `rateLimit` option this configures. */
export interface AuthRateLimitOptions {
  readonly enabled: true;
  readonly storage: "database";
  readonly modelName: string;
  readonly window: number;
  readonly max: number;
  readonly customRules: Readonly<Record<string, AuthRateLimit>>;
}

/**
 * The headers a client's network address is read from, in order.
 *
 * **Shared with the Claim's and the resend action's limiters**, whose
 * transport reads the same list (`apps/web/src/lib/client-address.ts`, pinned
 * to this one by its test). What the list trusts, and why only on Vercel, is
 * recorded there.
 */
export const CLIENT_ADDRESS_HEADERS = [
  "x-vercel-forwarded-for",
  "x-forwarded-for",
] as const;

/**
 * Better Auth's `rateLimit` option.
 *
 * - **`enabled: true`, stated.** better-auth 1.7.4 resolves a missing `enabled`
 *   to `NODE_ENV === "production"`, so every preview and local run would
 *   otherwise be unlimited — and nothing would test the limit.
 * - **`storage: "database"`.** The default is an in-process `Map`, and on
 *   Vercel every serverless instance has its own, so memory storage would
 *   limit nothing. Secondary storage would need a Redis we do not run.
 * - **`customRules` keys are paths as Better Auth routes them**: the pathname
 *   with `/api/auth` removed and trailing slashes stripped, compared exactly.
 *   Each is proved to bind by `auth-rate-limit.integration.test.ts`.
 *
 * No rule for `/sign-up/email`: #150's `disabledPaths` answers it 404 before
 * the limiter runs, so a rule there could never apply.
 */
export function authRateLimitOptions(
  limits: AuthRateLimits = AUTH_RATE_LIMITS,
): AuthRateLimitOptions {
  return {
    enabled: true,
    storage: "database",
    modelName: AUTH_RATE_LIMIT_MODEL,
    window: limits.default.window,
    max: limits.default.max,
    customRules: {
      "/sign-in/email": { ...limits.signInEmail },
      "/request-password-reset": { ...limits.requestPasswordReset },
      "/send-verification-email": { ...limits.sendVerificationEmail },
    },
  };
}

/**
 * Better Auth's `advanced.ipAddress` option: how its limiter identifies a
 * client, made to agree with `clientAddressBucket`.
 *
 * - The same headers, in the same order.
 * - IPv6 counted per `/64` (Better Auth's default, stated), and an IPv4-mapped
 *   IPv6 address counted as its IPv4 address, which Better Auth does unasked.
 * - **One difference, deliberately kept.** With no `trustedProxies`, Better
 *   Auth trusts a header only when it holds a single address, and puts a
 *   request whose headers hold none into one shared `no-trusted-ip` bucket per
 *   path — the analogue of our `unknown` bucket. Our transport takes the first
 *   entry of a list instead. On Vercel the edge sets both headers to one
 *   address, so the two agree there; elsewhere the headers are
 *   client-writable anyway. Setting `trustedProxies` to close the gap would
 *   add a spoofing surface to buy nothing.
 */
export function authClientAddressOptions(): {
  readonly ipAddressHeaders: string[];
  readonly ipv6Subnet: 64;
  /**
   * Never `true`. With it, Better Auth skips rate limiting entirely for a
   * request whose address it cannot read, so omitting the forwarded headers
   * would bypass every limit. Pinned by a unit and an integration test.
   */
  readonly disableIpTracking?: false;
} {
  return {
    ipAddressHeaders: [...CLIENT_ADDRESS_HEADERS],
    ipv6Subnet: 64,
  };
}
