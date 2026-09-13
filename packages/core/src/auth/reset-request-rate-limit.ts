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
 * How many password-reset requests the site's own request form accepts from
 * one client address in one fixed window
 * ([#192](https://github.com/joshstothard/3moji/issues/192)).
 *
 * **Derived from `AUTH_RATE_LIMITS.requestPasswordReset`, not restated**, for
 * the reason the sign-in form's limit is (#180): the form is a server action
 * that calls `auth.api.requestPasswordReset` directly, which Better Auth's
 * limiter never sees, so without this `POST /api/auth/request-password-reset`
 * would be limited while the form in front of the same email would not.
 * Tuning the endpoint tunes the form. Better Auth's window is in seconds,
 * ours in milliseconds.
 *
 * **The numbers match; the window semantics do not.** Better Auth's counter
 * resets a window after its last admitted request. This one is a fixed window
 * on the shared `claim_rate_limit` table, so one client can make up to twice
 * the limit across a boundary — the price of the atomic one-statement
 * increment every limiter on that table shares.
 *
 * The window must not exceed {@link RATE_LIMIT_RETENTION_MS}.
 */
export const RESET_REQUEST_CLIENT_RATE_LIMIT: ClaimRateLimit = {
  maxPerWindow: AUTH_RATE_LIMITS.requestPasswordReset.max,
  windowMs: AUTH_RATE_LIMITS.requestPasswordReset.window * 1000,
};

/**
 * The per-client answer. **No "when"**, as sign-in's has none: the form works
 * without JavaScript, so a "when" would travel in a query string, and "wait a
 * while" says what a person needs.
 */
export type ResetRequestClientAdmission =
  { readonly state: "admitted" } | { readonly state: "rate-limited" };

/** The reset request form's per-client-address limit, bound to its store and key. */
export interface ResetRequestClientRateLimiter {
  /** `clientAddress` as the transport read it: not trusted, maybe missing. */
  admit(
    clientAddress: string | undefined,
  ): Promise<ResetRequestClientAdmission>;
}

export interface ResetRequestClientRateLimiterInput {
  /** The Claim's store: same table, same atomic increment (#157). */
  readonly store: ClaimRateLimitStore;
  readonly clock: Clock;
  /** The auth secret the bucket key is derived from. */
  readonly secret: string;
  readonly limit?: ClaimRateLimit;
}

/**
 * The bucket one client's reset requests count against, as stored:
 * `reset-request-client:` and a keyed hash of the grouped address — the
 * Claim's, resend's and sign-in's grouping and hashing, under its own kind.
 */
export function resetRequestClientBucket(
  secret: string,
  clientAddress: string | undefined,
): string {
  return keyedRateLimitBucket(
    secret,
    "reset-request-client",
    clientAddressBucket(clientAddress),
  );
}

/**
 * The reset request form's per-client-address limit.
 *
 * **Asked before the address is read.** It is handed the client address and
 * nothing else, so a registered address and an unregistered one are counted
 * and refused identically: the refusal says nothing about who was named.
 *
 * A store that cannot count makes `admit` reject, and the caller refuses the
 * request: fail closed. Asking for a reset needs the database anyway.
 */
export function createResetRequestClientRateLimiter(
  input: ResetRequestClientRateLimiterInput,
): ResetRequestClientRateLimiter {
  if (input.secret === "") {
    throw new Error(
      "createResetRequestClientRateLimiter requires the auth secret; without one every bucket hash could be recomputed from a guess.",
    );
  }
  const limit = input.limit ?? RESET_REQUEST_CLIENT_RATE_LIMIT;

  return {
    async admit(clientAddress) {
      const now = input.clock.now();

      const [count] = await input.store.record(
        [
          {
            bucket: resetRequestClientBucket(input.secret, clientAddress),
            windowStart: windowStartOf(now, limit.windowMs),
          },
        ],
        // The shared retention, never a shorter window of this limit's own:
        // pruning by one would delete another limiter's live counter.
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
