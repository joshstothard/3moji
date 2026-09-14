import { isHTTPAccessFallbackError } from "next/dist/client/components/http-access-fallback/http-access-fallback";
import { isRedirectError } from "next/dist/client/components/redirect-error";

import { readCorrelationId } from "./request-context";

/**
 * One structured JSON line per call at every API boundary (#156).
 *
 * A boundary is a route handler or an exported server action: the places a
 * request from outside enters the application. Each writes **exactly one**
 * line per call, on success and on failure, to `console.log`:
 *
 * ```json
 * {"event":"api_boundary","boundary":"claim.submit","outcome":"redirected","durationMs":512,"correlationId":"…"}
 * ```
 *
 * The auth route adds `endpoint`, a literal from {@link AUTH_ENDPOINTS}.
 *
 * **Nothing free-text reaches the line**, for the reason `logFailure` gives
 * (#134): every value is a literal from a fixed list in this file, a rounded
 * number, or a correlation id that passed the allow-list. There is no field
 * for a message, a path, a query string, a form value or an address, so there
 * is nowhere for personal data to go. Failures still get their own
 * `logFailure` line, on `console.error`, from the boundary's own catch — the
 * two share a `correlationId`, and this one never repeats the error.
 *
 * **Why `console.log` and not `console.error`.** A boundary line is written for
 * every call, and most calls succeed; the error stream stays the one alerting
 * keys on, and a failure is findable on this one by `outcome`.
 *
 * The outcome vocabulary and each boundary's mapping are documented in
 * `docs/architecture/system-overview.md` § API boundary logging.
 */

/** The `event` every boundary line carries. */
export const BOUNDARY_EVENT = "api_boundary";

/**
 * What happened, in words that do not depend on who asked.
 *
 * - `ok` — answered with a value or a 2xx.
 * - `redirected` — succeeded, and the answer is a redirect.
 * - `rejected` — refused the input: invalid, taken, forbidden, wrong
 *   credentials, a link that no longer works.
 * - `rate-limited` — refused because of a limit.
 * - `not-found` — `notFound()`, or a 404.
 * - `failed` — could not answer: something threw, or the boundary degraded.
 */
export const BOUNDARY_OUTCOMES = [
  "ok",
  "redirected",
  "rejected",
  "rate-limited",
  "not-found",
  "failed",
] as const;
export type BoundaryOutcome = (typeof BOUNDARY_OUTCOMES)[number];

/**
 * Every boundary's name. `api-boundaries.test.ts` fails unless each has
 * exactly one case, and unless every route handler and server action export
 * has one of them.
 */
export const BOUNDARIES = [
  "auth.get",
  "auth.post",
  "claim.verify",
  "availability.check",
  "claim.submit",
  "claim.form",
  "sign-in.submit",
  "sign-in.form",
  "sign-out.form",
  "profile.save",
  "verification.resend",
  "password-reset.request",
  "password-reset.set",
  "og-image.generic",
  "og-image.handle",
  "viewer.read",
  "account.delete",
  "search.read",
] as const;
export type Boundary = (typeof BOUNDARIES)[number];

/**
 * Better Auth's own endpoints (better-auth 1.7.4, `dist/api/routes`), as
 * literals. The auth route logs which one was asked for **by matching against
 * this list**, never by copying the path: `/reset-password/<token>` carries a
 * reset token in a path segment, and `/callback/<id>` an arbitrary one. So
 * those two are logged as their patterns, and anything not listed as `other`.
 * `/sign-up/email` and `/sign-in/social` are listed although `createAuth`
 * refuses them (#150): a probe for them is worth seeing.
 */
export const AUTH_ENDPOINTS = [
  "account-info",
  "callback/:id",
  "change-email",
  "change-password",
  "delete-user",
  "delete-user/callback",
  "error",
  "get-access-token",
  "get-session",
  "link-social",
  "list-accounts",
  "list-sessions",
  "ok",
  "refresh-token",
  "request-password-reset",
  "reset-password",
  "reset-password/:token",
  "revoke-other-sessions",
  "revoke-session",
  "revoke-sessions",
  "send-verification-email",
  "sign-in/email",
  "sign-in/social",
  "sign-out",
  "sign-up/email",
  "unlink-account",
  "update-session",
  "update-user",
  "verify-email",
  "verify-password",
  "other",
] as const;
export type AuthEndpoint = (typeof AUTH_ENDPOINTS)[number];

const AUTH_BASE_PATH = "/api/auth/";

/** The endpoints whose second segment is a value, and the pattern each logs as. */
const PARAMETERISED: Readonly<Record<string, AuthEndpoint>> = {
  "reset-password": "reset-password/:token",
  callback: "callback/:id",
};

function isAuthEndpoint(value: string): value is AuthEndpoint {
  return (AUTH_ENDPOINTS as readonly string[]).includes(value);
}

/**
 * Which Better Auth endpoint a request URL names, as a literal from
 * {@link AUTH_ENDPOINTS}. The query string is never read, and a path segment
 * is returned only when it equals a listed literal.
 */
export function authEndpointOf(url: string): AuthEndpoint {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return "other";
  }
  if (!pathname.startsWith(AUTH_BASE_PATH)) return "other";

  const rest = pathname.slice(AUTH_BASE_PATH.length);
  if (rest !== "other" && isAuthEndpoint(rest) && !rest.includes(":")) {
    return rest;
  }

  const segments = rest.split("/");
  const [first, second] = segments;
  if (segments.length === 2 && first !== undefined && second !== "") {
    return PARAMETERISED[first] ?? "other";
  }
  return "other";
}

/** A response status as an outcome, for the auth route's answers. */
export function outcomeOfStatus(status: number): BoundaryOutcome {
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "failed";
  if (status >= 400) return "rejected";
  if (status >= 300) return "redirected";
  return "ok";
}

/**
 * The outcome of a Next.js control-flow throw, or `undefined` for anything
 * else. Identified by Next.js's own digest checks — `isRedirectError` and
 * `isHTTPAccessFallbackError`, the functions `unstable_rethrow` uses — never by
 * the message, which an ordinary error can repeat. `boundary-log.test.ts`
 * throws the real `redirect`, `permanentRedirect` and `notFound`, so an upgrade
 * that changes what they throw fails the build.
 */
function controlFlowOutcome(error: unknown): BoundaryOutcome | undefined {
  if (isRedirectError(error)) return "redirected";
  if (isHTTPAccessFallbackError(error)) {
    const status = Number(error.digest.split(";")[1]);
    return status === 404 ? "not-found" : "rejected";
  }
  return undefined;
}

/** Lets a boundary say what its answer means before it redirects. */
export type RecordOutcome = (outcome: BoundaryOutcome) => void;

export interface BoundaryOptions<T> {
  /** The outcome of a returned answer. Without it, a return is `ok`. */
  readonly outcomeOf?: (value: T) => BoundaryOutcome;
  /** The auth route's endpoint literal. */
  readonly endpoint?: AuthEndpoint;
}

interface BoundaryLine {
  readonly event: typeof BOUNDARY_EVENT;
  readonly boundary: Boundary;
  readonly outcome: BoundaryOutcome;
  readonly durationMs: number;
  readonly correlationId: string;
  readonly endpoint?: AuthEndpoint;
}

async function write(
  boundary: Boundary,
  outcome: BoundaryOutcome,
  started: number,
  endpoint: AuthEndpoint | undefined,
): Promise<void> {
  try {
    const line: BoundaryLine = {
      event: BOUNDARY_EVENT,
      boundary,
      outcome,
      durationMs: Math.max(0, Math.round(performance.now() - started)),
      correlationId: await readCorrelationId(),
      ...(endpoint === undefined ? {} : { endpoint }),
    };
    console.log(JSON.stringify(line));
  } catch {
    // A log line must never change the answer.
  }
}

/**
 * Run a boundary's work and write its one line.
 *
 * - A **returned** answer is logged as the outcome `run` recorded, else
 *   `outcomeOf(value)`, else `ok`.
 * - A **Next.js redirect or `notFound`** is logged as the outcome `run`
 *   recorded before it, else `redirected` / `not-found` — and is **always
 *   rethrown**, because that throw is how Next.js sends the answer.
 * - **Anything else thrown** is `failed`, whatever was recorded, and is
 *   rethrown untouched: this adds a line, never a catch.
 *
 * The duration is taken around the whole of `run`, so a response floor inside
 * the use case is inside it too, and a padded fast branch does not log fast.
 */
export async function atBoundary<T>(
  boundary: Boundary,
  run: (record: RecordOutcome) => Promise<T>,
  options: BoundaryOptions<T> = {},
): Promise<T> {
  const started = performance.now();
  let recorded: BoundaryOutcome | undefined;
  const record: RecordOutcome = (outcome) => {
    recorded = outcome;
  };

  let value: T;
  try {
    value = await run(record);
  } catch (error) {
    const control = controlFlowOutcome(error);
    await write(
      boundary,
      control === undefined ? "failed" : (recorded ?? control),
      started,
      options.endpoint,
    );
    throw error;
  }

  let outcome: BoundaryOutcome = recorded ?? "ok";
  if (recorded === undefined && options.outcomeOf !== undefined) {
    try {
      outcome = options.outcomeOf(value);
    } catch {
      outcome = "failed";
    }
  }
  await write(boundary, outcome, started, options.endpoint);
  return value;
}
