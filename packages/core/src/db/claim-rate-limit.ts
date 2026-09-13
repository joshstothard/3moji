import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * How many Claim submissions one bucket has made in one window
 * ([#157](https://github.com/joshstothard/3moji/issues/157)).
 *
 * A bucket is a client network address or an email address, and **neither is
 * stored**. `bucket` is `client:` or `email:` followed by a keyed hash (HMAC)
 * of the value, under a key derived from the auth secret — see
 * {@link ../handle/claim-rate-limit.claimRateLimitBuckets}. Somebody holding this
 * table alone cannot tell who tried to claim, and cannot confirm a guess
 * without the secret either, which a plain SHA-256 of an email address would
 * let them do.
 *
 * **Fixed windows, counted in place.** One row per bucket per window, and the
 * count is incremented by `INSERT … ON CONFLICT … DO UPDATE … RETURNING`, so two
 * concurrent submissions cannot both read the old count and both slip under the
 * limit. A rolling window would need the individual submission times, and a
 * decision over those cannot be taken atomically in one statement.
 *
 * Rows are not tied to an Account and have no foreign key: the counter is about
 * submissions, and a submission naming an address counts whether or not that
 * address has an Account — which is exactly what keeps the limit from
 * answering "is this address registered".
 */
export const claimRateLimit = pgTable(
  "claim_rate_limit",
  {
    /** `client:<hmac hex>` or `email:<hmac hex>`. Never an address. */
    bucket: text("bucket").notNull(),
    /**
     * The start of the window this row counts, from the injected `Clock` and
     * never a SQL default: the window is a domain rule, and `defaultNow()`
     * would put it where no test can move time.
     */
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    /** Submissions in this bucket and window, including the latest. */
    count: integer("count").notNull(),
  },
  (table) => [
    /** The conflict target of the atomic increment. */
    primaryKey({
      name: "claim_rate_limit_pkey",
      columns: [table.bucket, table.windowStart],
    }),
    /** What forgetting ended windows scans. */
    index("claim_rate_limit_window_start_idx").on(table.windowStart),
    check("claim_rate_limit_count_positive", sql`${table.count} > 0`),
  ],
);
