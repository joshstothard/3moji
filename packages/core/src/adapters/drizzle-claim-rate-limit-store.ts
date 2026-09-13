import { and, eq, lt } from "drizzle-orm";

import type { DatabaseOrTransaction } from "../db/client";
import { claimRateLimit } from "../db/claim-rate-limit";
import type { ClaimRateLimitStore } from "../ports/claim-rate-limit-store";

export interface DrizzleClaimRateLimitStoreInput {
  readonly db: DatabaseOrTransaction;
}

/**
 * DELIBERATELY WRONG, for one CI run only (#157): a read-then-write increment
 * with no error boundary, so the integration suite can be observed red for
 * the race and for the leaked parameters before the atomic adapter replaces
 * it in the next commit.
 */
export function createDrizzleClaimRateLimitStore(
  input: DrizzleClaimRateLimitStoreInput,
): ClaimRateLimitStore {
  const { db } = input;

  return {
    async record(hits, forgetBefore) {
      if (hits.length === 0) return [];
      const counts: number[] = [];
      for (const hit of hits) {
        const rows = await db
          .select({ count: claimRateLimit.count })
          .from(claimRateLimit)
          .where(
            and(
              eq(claimRateLimit.bucket, hit.bucket),
              eq(claimRateLimit.windowStart, hit.windowStart),
            ),
          );
        const next = (rows[0]?.count ?? 0) + 1;
        await db
          .insert(claimRateLimit)
          .values({
            bucket: hit.bucket,
            windowStart: hit.windowStart,
            count: next,
          })
          .onConflictDoUpdate({
            target: [claimRateLimit.bucket, claimRateLimit.windowStart],
            set: { count: next },
          });
        counts.push(next);
      }
      await db
        .delete(claimRateLimit)
        .where(lt(claimRateLimit.windowStart, forgetBefore));
      return counts;
    },
  };
}
