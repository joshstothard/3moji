import { and, asc, isNotNull, or, sql, type SQL } from "drizzle-orm";

import type { DatabaseOrTransaction } from "../db/client";
import { withSafeDatabaseErrors } from "../db/database-error";
import { handle } from "../db/handle";
import type { HandleKey } from "../db/handle-key";
import type { HandleSearchIndex } from "../ports/handle-search-index";

/**
 * {@link HandleSearchIndex} over the `handle` table
 * ([ADR-0012](../../../../docs/adr/0012-header-search-lists-claimed-handles-with-display-names-capped-and-rate-limited.md),
 * [#254](https://github.com/joshstothard/3moji/issues/254)).
 *
 * One statement: claimed rows (`claimed_at IS NOT NULL`) whose key holds, for
 * each group, at least one of its emoji — `strpos(key, $emoji) > 0`, every
 * emoji a bound parameter, never interpolated text.
 *
 * **Claimed is the column, not the clock.** `claimed_at` is set once, when the
 * Claim becomes final, so a held Handle — a live hold or an expired one this
 * search has no business freeing — is excluded without an injected `now`, and
 * there is no second copy of `ownershipOf`'s expiry rule here.
 *
 * **A scan, measured by nothing yet.** `strpos` cannot use the primary key's
 * B-tree, so this reads the table; a claimed Handle is three code points, and
 * the search is rate limited per client. As with the Profile repository: if it
 * ever shows up in a slow-query log, measure before adding an index.
 *
 * Ordered by key and limited, so a limited answer is the same keys every time.
 * The order that matters to a visitor is decided in `searchHandles`.
 */
export function createDrizzleHandleSearchIndex(
  db: DatabaseOrTransaction,
): HandleSearchIndex {
  return {
    async claimedKeysContaining(
      groups: readonly (readonly string[])[],
      limit: number,
    ): Promise<readonly HandleKey[]> {
      const containment = groups.map((group) =>
        or(
          ...group.map(
            (emoji): SQL => sql`strpos(${handle.key}, ${emoji}) > 0`,
          ),
        ),
      );
      if (containment.length === 0 || containment.includes(undefined)) {
        // No groups, or an empty one, names no Handle: nothing to ask.
        return [];
      }

      const rows = await withSafeDatabaseErrors(() =>
        db
          .select({ key: handle.key })
          .from(handle)
          .where(and(isNotNull(handle.claimedAt), ...containment))
          .orderBy(asc(handle.key))
          .limit(limit),
      );
      return rows.map((row) => row.key);
    },
  };
}
