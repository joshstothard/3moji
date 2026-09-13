import {
  RATE_LIMIT_RETENTION_MS,
  clientAddressBucket,
  keyedRateLimitBucket,
  windowStartOf,
  type ClaimRateLimit,
} from "../handle/claim-rate-limit";
import type { ClaimRateLimitStore } from "../ports/claim-rate-limit-store";
import type { Clock } from "../ports/clock";
import { AUTH_RATE_LIMITS } from "./auth-rate-limit";

/**
 * How many sign-in attempts the site's own sign-in form accepts from one
 * client address in one fixed window
 * ([#180](https://github.com/joshstothard/3moji/issues/180)).
 *
 * **Derived from `AUTH_RATE_LIMITS.signInEmail`, not restated**, so the form and
 * Better Auth's `POST /api/auth/sign-in/email` cannot drift apart: the form is a
 * server action that calls `auth.api.signInEmail` directly, which Better Auth's
 * limiter never sees, so without this the endpoint would be limited and the
 * form in front of the same credential check would not. Tuning the endpoint
 * tunes the form. `sign-in-rate-limit.test.ts` pins both the values and the
 * equality, and converts units: Better Auth's window is in seconds, ours in ms.
 *
 * **The numbers match; the window semantics do not.** Better Auth's counter
 * resets a window after its last admitted request. This one is a fixed window
 * on the shared `claim_rate_limit` table, so one client can make up to twice
 * the limit across a boundary — the price of the atomic one-statement
 * increment every limiter on that table shares.
 *
 * The window must not exceed {@link RATE_LIMIT_RETENTION_MS}.
 */
export const SIGN_IN_CLIENT_RATE_LIMIT: ClaimRateLimit = {
  maxPerWindow: AUTH_RATE_LIMITS.signInEmail.max,
  windowMs: AUTH_RATE_LIMITS.signInEmail.window * 1000,
};

/**
 * The per-client answer. **No "when"**, deliberately unlike resend's: the form
 * works without JavaScript, so a "when" would travel in a query string, and
 * one generic "wait a few minutes" says all a person needs. It also leaves room
 * for the repo owner to add a per-account limit (see `auth.md`) without the
 * answer starting to reveal which limit bound.
 */
export type SignInClientAdmission =
  { readonly state: "admitted" } | { readonly state: "rate-limited" };

/** The sign-in form's per-client-address limit, bound to its store and key. */
export interface SignInClientRateLimiter {
  /** `clientAddress` as the transport read it: not trusted, maybe missing. */
  admit(clientAddress: string | undefined): Promise<SignInClientAdmission>;
}

export interface SignInClientRateLimiterInput {
  /** The Claim's store: same table, same atomic increment (#157). */
  readonly store: ClaimRateLimitStore;
  readonly clock: Clock;
  /** The auth secret the bucket key is derived from. */
  readonly secret: string;
  readonly limit?: ClaimRateLimit;
}

/**
 * The bucket one client's sign-in attempts count against, as stored:
 * `sign-in-client:` and a keyed hash of the grouped address — the Claim's and
 * resend's grouping and hashing, under its own kind.
 */
export function signInClientBucket(
  secret: string,
  clientAddress: string | undefined,
): string {
  return keyedRateLimitBucket(
    secret,
    "sign-in-client",
    clientAddressBucket(clientAddress),
  );
}

/**
 * The sign-in form's per-client-address limit.
 *
 * **Asked before any credential is evaluated.** It is handed the client address
 * and nothing else — never the email address, never the password — so a
 * registered address and an unregistered one, a right password and a wrong
 * one, are all counted and refused identically. A correct password beyond the
 * limit is refused exactly like a wrong one, which is what makes the limit a
 * limit on guessing rather than a limit on failing.
 *
 * A store that cannot count makes `admit` reject, and the caller refuses the
 * sign-in: fail closed. Signing in needs the database anyway.
 */
export function createSignInClientRateLimiter(
  input: SignInClientRateLimiterInput,
): SignInClientRateLimiter {
  if (input.secret === "") {
    throw new Error(
      "createSignInClientRateLimiter requires the auth secret; without one every bucket hash could be recomputed from a guess.",
    );
  }
  const limit = input.limit ?? SIGN_IN_CLIENT_RATE_LIMIT;

  return {
    async admit(clientAddress) {
      const now = input.clock.now();

      const [count] = await input.store.record(
        [
          {
            bucket: signInClientBucket(input.secret, clientAddress),
            windowStart: windowStartOf(now, limit.windowMs),
          },
        ],
        // The shared retention, never this limit's own fifteen minutes: pruning
        // by a shorter window would delete a Claim's live hour on the table.
        new Date(
          now.getTime() - Math.max(limit.windowMs, RATE_LIMIT_RETENTION_MS),
        ),
      );
      if (count === undefined) {
        throw new Error("the rate-limit store answered with no count.");
      }

      return count > limit.maxPerWindow
        ? { state: "rate-limited" }
        : { state: "admitted" };
    },
  };
}
