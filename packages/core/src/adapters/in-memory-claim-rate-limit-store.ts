import type {
  ClaimRateLimitHit,
  ClaimRateLimitStore,
} from "../ports/claim-rate-limit-store";

export interface InMemoryClaimRateLimitStore extends ClaimRateLimitStore {
  /** Every live row, as `bucket@windowStartIso` to count. */
  readonly rows: ReadonlyMap<string, number>;
}

const rowKey = (hit: ClaimRateLimitHit): string =>
  `${hit.bucket}@${hit.windowStart.toISOString()}`;

/**
 * A {@link ClaimRateLimitStore} over a `Map`.
 *
 * Lives in `src` rather than a test helper because two suites use it: the
 * limiter's unit tests here, and the web app's end-to-end comparison of a
 * rate-limited registered address against an unregistered one, which runs the
 * real limiter from source.
 *
 * It honours the port exactly — counts come back in the order the hits were
 * given, a repeated bucket is refused as the real `INSERT … ON CONFLICT`
 * refuses it, and ended windows are forgotten — because a fake laxer than its
 * adapter turns a green unit test into a production defect. JavaScript runs the
 * body of `record` to completion before another call can start, so the
 * increment is atomic here by construction; the real adapter's atomicity is
 * proved against Postgres.
 */
export function createInMemoryClaimRateLimitStore(): InMemoryClaimRateLimitStore {
  const rows = new Map<string, number>();
  const starts = new Map<string, Date>();

  return {
    rows,
    record(hits, forgetBefore) {
      const buckets = new Set(hits.map((hit) => hit.bucket));
      if (buckets.size !== hits.length) {
        return Promise.reject(
          new Error("a rate-limit record must name distinct buckets."),
        );
      }

      const counts = hits.map((hit) => {
        const key = rowKey(hit);
        const count = (rows.get(key) ?? 0) + 1;
        rows.set(key, count);
        starts.set(key, hit.windowStart);
        return count;
      });

      for (const [key, start] of starts) {
        if (start.getTime() < forgetBefore.getTime()) {
          rows.delete(key);
          starts.delete(key);
        }
      }

      return Promise.resolve(counts);
    },
  };
}
