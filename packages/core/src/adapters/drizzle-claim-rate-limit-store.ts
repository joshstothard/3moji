import { lt, sql } from "drizzle-orm";

import type { DatabaseOrTransaction } from "../db/client";
import { claimRateLimit } from "../db/claim-rate-limit";
import { withSafeDatabaseErrors } from "../db/database-error";
import type { ClaimRateLimitStore } from "../ports/claim-rate-limit-store";

export interface DrizzleClaimRateLimitStoreInput {
  readonly db: DatabaseOrTransaction;
}

/**
 * {@link ClaimRateLimitStore} over `claim_rate_limit`
 * ([#157](https://github.com/joshstothard/3moji/issues/157)).
 *
 * **The increment is one statement**, and that is the whole design:
 *
 * ```sql
 * INSERT INTO claim_rate_limit (bucket, window_start, count)
 * VALUES ($1, $2, 1), ($3, $4, 1)
 * ON CONFLICT (bucket, window_start)
 * DO UPDATE SET count = claim_rate_limit.count + 1
 * RETURNING bucket, window_start, count
 * ```
 *
 * Postgres takes a row lock on the conflicting row before it evaluates the
 * `DO UPDATE`, so a concurrent submission to the same bucket waits and then
 * increments the value the first one wrote. Read-then-write — `SELECT` the
 * count, decide, `UPDATE` — lets both read the old count and both get in, which
 * is the failure the concurrency test in the integration suite exists to catch.
 *
 * **Deadlocks cannot form between two submissions**, because every submission
 * locks its buckets in the same order: the client bucket, then the email
 * bucket, and the two are always distinct (their `client:` and `email:`
 * prefixes differ).
 *
 * Every statement binds a bucket hash, so each failure leaves the adapter as a
 * `DatabaseQueryFailed` without its parameters (#144). A failure rejects; the
 * caller refuses the Claim.
 */
export function createDrizzleClaimRateLimitStore(
  input: DrizzleClaimRateLimitStoreInput,
): ClaimRateLimitStore {
  const { db } = input;

  return {
    async record(hits, forgetBefore) {
      if (hits.length === 0) return [];

      return withSafeDatabaseErrors(async () => {
        const rows = await db
          .insert(claimRateLimit)
          .values(
            hits.map((hit) => ({
              bucket: hit.bucket,
              windowStart: hit.windowStart,
              count: 1,
            })),
          )
          .onConflictDoUpdate({
            target: [claimRateLimit.bucket, claimRateLimit.windowStart],
            // Qualified with the table name: inside `DO UPDATE`, this is the
            // row already stored, where `excluded.count` would be the 1 just
            // proposed.
            set: { count: sql`"claim_rate_limit"."count" + 1` },
          })
          .returning({
            bucket: claimRateLimit.bucket,
            windowStart: claimRateLimit.windowStart,
            count: claimRateLimit.count,
          });

        // Forget windows the limit no longer reads. Every current window
        // starts at or after `forgetBefore`, so this never touches a row the
        // statement above just counted.
        await db
          .delete(claimRateLimit)
          .where(lt(claimRateLimit.windowStart, forgetBefore));

        // `RETURNING` promises no order, so each count is matched to its hit.
        return hits.map((hit) => {
          const row = rows.find(
            (candidate) =>
              candidate.bucket === hit.bucket &&
              candidate.windowStart.getTime() === hit.windowStart.getTime(),
          );
          if (row === undefined) {
            throw new Error(
              "the rate-limit increment returned no row for one of its buckets.",
            );
          }
          return row.count;
        });
      });
    },
  };
}
