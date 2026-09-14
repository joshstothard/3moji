import type { ClaimRateLimitStore } from "../ports/claim-rate-limit-store";
import type { Clock } from "../ports/clock";
import {
  RATE_LIMIT_RETENTION_MS,
  clientAddressBucket,
  keyedRateLimitBucket,
  windowStartOf,
  type ClaimRateLimit,
} from "./claim-rate-limit";

const MINUTE_MS = 60 * 1000;

/**
 * How many searches one client address may make in one fixed window
 * ([ADR-0012](../../../../docs/adr/0012-header-search-lists-claimed-handles-with-display-names-capped-and-rate-limited.md)
 * decision 6): sixty in ten minutes.
 *
 * **A starting value to tune, like the Claim's.** With five Handles a response
 * it bounds how fast one client walks the claimed Handles; the island debounces
 * typing by 250 ms, so a person typing a few queries a minute never meets it.
 * Many addresses walk faster, which the ADR accepts.
 *
 * Fixed, not rolling, so a client can make up to twice the limit across a
 * window boundary — the price of the one-statement increment every limiter on
 * `claim_rate_limit` shares. The window must not exceed
 * {@link RATE_LIMIT_RETENTION_MS}.
 */
export const SEARCH_CLIENT_RATE_LIMIT: ClaimRateLimit = {
  maxPerWindow: 60,
  windowMs: 10 * MINUTE_MS,
};

/**
 * The answer. **No "when"**: decision 6 answers a refused search with a plain
 * `429` and no retry hint.
 */
export type SearchClientAdmission =
  { readonly state: "admitted" } | { readonly state: "rate-limited" };

/** The search's per-client-address limit, bound to its store and key. */
export interface SearchClientRateLimiter {
  /** `clientAddress` as the transport read it: not trusted, maybe missing. */
  admit(clientAddress: string | undefined): Promise<SearchClientAdmission>;
}

export interface SearchClientRateLimiterInput {
  /** The Claim's store: same table, same atomic increment (#157). */
  readonly store: ClaimRateLimitStore;
  readonly clock: Clock;
  /** The auth secret the bucket key is derived from. */
  readonly secret: string;
  readonly limit?: ClaimRateLimit;
}

/**
 * The bucket one client's searches count against, as stored: `search-client:`
 * and a keyed hash of the grouped address — the other limiters' grouping and
 * hashing, under its own kind.
 */
export function searchClientBucket(
  secret: string,
  clientAddress: string | undefined,
): string {
  return keyedRateLimitBucket(
    secret,
    "search-client",
    clientAddressBucket(clientAddress),
  );
}

/**
 * The search's per-client-address limit.
 *
 * **Every request counts**, before the query is read: an empty or unknown
 * query costs a request like any other, so the limit is a limit on asking.
 *
 * A store that cannot count makes `admit` reject, and the route answers a
 * failure rather than searching: fail closed, as every limiter on the table
 * does.
 */
export function createSearchClientRateLimiter(
  input: SearchClientRateLimiterInput,
): SearchClientRateLimiter {
  if (input.secret === "") {
    throw new Error(
      "createSearchClientRateLimiter requires the auth secret; without one every bucket hash could be recomputed from a guess.",
    );
  }
  const limit = input.limit ?? SEARCH_CLIENT_RATE_LIMIT;

  return {
    async admit(clientAddress) {
      const now = input.clock.now();

      const [count] = await input.store.record(
        [
          {
            bucket: searchClientBucket(input.secret, clientAddress),
            windowStart: windowStartOf(now, limit.windowMs),
          },
        ],
        // The shared retention, never this limit's own ten minutes: pruning by
        // a shorter window would delete a Claim's live hour on the table.
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
