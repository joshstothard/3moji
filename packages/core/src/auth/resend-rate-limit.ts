import {
  RATE_LIMIT_RETENTION_MS,
  clientAddressBucket,
  keyedRateLimitBucket,
  windowStartOf,
  type ClaimRateLimit,
} from "../handle/claim-rate-limit";
import type { ClaimRateLimitStore } from "../ports/claim-rate-limit-store";
import type { Clock } from "../ports/clock";

const HOUR_MS = 60 * 60 * 1000;

/**
 * How many verification-link resends one client address may ask for in one
 * fixed hour ([#158](https://github.com/joshstothard/3moji/issues/158)).
 *
 * **A starting value to tune**, flagged for the repo owner on the pull request.
 * It sits **beside** `RESEND_LIMITS`, not instead of it: that one is per
 * Account and bounds the mail one inbox receives; this one is per client and
 * bounds how many addresses one client can make us look up and mail. Ten
 * matches the Claim's per-client limit, looser than the per-Account three
 * because one address can be a household, an office or a carrier's NAT.
 *
 * The window must not exceed {@link RATE_LIMIT_RETENTION_MS}: every limiter on
 * the shared table prunes by it.
 */
export const RESEND_CLIENT_RATE_LIMIT: ClaimRateLimit = {
  maxPerWindow: 10,
  windowMs: HOUR_MS,
};

/**
 * The per-client answer. Unlike the Claim's, a refusal says **when**: there is
 * only one window behind it, so "when" cannot reveal which limit bound, and the
 * hold screen already shows a retry hint for the per-Account refusals.
 */
export type ResendClientAdmission =
  | { readonly state: "admitted" }
  | { readonly state: "rate-limited"; readonly retryAfterMs: number };

/** The resend action's per-client-address limit, bound to its store and key. */
export interface ResendClientRateLimiter {
  /** `clientAddress` as the transport read it: not trusted, maybe missing. */
  admit(clientAddress: string | undefined): Promise<ResendClientAdmission>;
}

export interface ResendClientRateLimiterInput {
  /** The Claim's store: same table, same atomic increment (#157). */
  readonly store: ClaimRateLimitStore;
  readonly clock: Clock;
  /** The auth secret the bucket key is derived from. */
  readonly secret: string;
  readonly limit?: ClaimRateLimit;
}

/**
 * The bucket one client's resends count against, as stored:
 * `resend-client:` and a keyed hash of the grouped address.
 *
 * The same grouping (`clientAddressBucket`) and the same keyed hash as the
 * Claim's buckets, under its own kind, so a client's resends and its Claims
 * are separate counters and neither table row names an address.
 */
export function resendClientBucket(
  secret: string,
  clientAddress: string | undefined,
): string {
  return keyedRateLimitBucket(
    secret,
    "resend-client",
    clientAddressBucket(clientAddress),
  );
}

/**
 * The resend action's per-client-address limit.
 *
 * **It reuses the Claim's store and table** rather than adding a second table
 * and a second hashing scheme: the question — how many requests has this
 * hashed bucket made in this fixed window, counting this one — is identical,
 * and so is the one-statement increment that answers it without a race.
 *
 * It counts every request, before anything reads the address, so an address
 * with no Account is limited exactly as a registered one — see
 * `resendVerification` for why the order matters. A store that cannot count
 * makes `admit` reject, and the action answers `failed`: fail closed.
 */
export function createResendClientRateLimiter(
  input: ResendClientRateLimiterInput,
): ResendClientRateLimiter {
  if (input.secret === "") {
    throw new Error(
      "createResendClientRateLimiter requires the auth secret; without one every bucket hash could be recomputed from a guess.",
    );
  }
  const limit = input.limit ?? RESEND_CLIENT_RATE_LIMIT;

  return {
    async admit(clientAddress) {
      const now = input.clock.now();
      const windowStart = windowStartOf(now, limit.windowMs);

      const [count] = await input.store.record(
        [
          {
            bucket: resendClientBucket(input.secret, clientAddress),
            windowStart,
          },
        ],
        // The shared retention, never this limit's own window: a shorter
        // window here would delete a Claim's live counter on the same table.
        new Date(
          now.getTime() - Math.max(limit.windowMs, RATE_LIMIT_RETENTION_MS),
        ),
      );
      if (count === undefined) {
        throw new Error("the rate-limit store answered with no count.");
      }

      return count > limit.maxPerWindow
        ? {
            state: "rate-limited",
            retryAfterMs:
              windowStart.getTime() + limit.windowMs - now.getTime(),
          }
        : { state: "admitted" };
    },
  };
}
