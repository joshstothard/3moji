import type { HandleKey } from "../db/handle-key";

/**
 * What the header search needs from the `handle` table
 * ([ADR-0012](../../../../docs/adr/0012-header-search-lists-claimed-handles-with-display-names-capped-and-rate-limited.md),
 * [#254](https://github.com/joshstothard/3moji/issues/254)).
 *
 * **A port of its own, not a second method on `HandleRepository`.** That port
 * answers one question about one key; this one finds keys, and a one- or
 * two-word query cannot be answered by enumerating keys first: `apple` in any
 * of three positions is tens of thousands of Handles. So the table is asked
 * which claimed Handles contain the query's emoji, and the domain decides
 * the rest.
 *
 * **A coarse read on purpose.** It says only that each group has at least one
 * of its emoji somewhere in the key. Whether the terms fit distinct positions,
 * whether a Handle is Reserved, and the order are `searchHandles`'s decisions,
 * unit-tested without a database, for the reason `ownershipOf` lives outside
 * the Handle repository's adapter.
 *
 * Read-only, and **claimed Handles only**: a held Handle is somebody's
 * unfinished Claim, and never appears in a search.
 */
export interface HandleSearchIndex {
  /**
   * Every claimed Handle whose key holds, for each group, at least one of that
   * group's emoji, at most `limit` of them.
   *
   * @param groups One entry per query term: the emoji that term names. Never
   * empty, and no group is empty.
   * @param limit The most keys to answer. Which keys a limited answer keeps is
   * the adapter's deterministic choice (ascending key).
   */
  claimedKeysContaining(
    groups: readonly (readonly string[])[],
    limit: number,
  ): Promise<readonly HandleKey[]>;

  /**
   * Every claimed Handle whose key holds, at each position, one of that
   * position's emoji: the exact matches of a three-term query, at most
   * `limit` of them.
   *
   * **A read of its own so decision 5's first tier cannot be truncated
   * away.** {@link claimedKeysContaining} keeps a limited answer by key order,
   * which has nothing to do with the search's order, so on a large table the
   * exact match could be past its cut. This read names only Handles that say
   * the whole query, a population far smaller than "holds an apple somewhere".
   *
   * @param positions Exactly three entries, one per position, none empty.
   * Anything else names no Handle and answers `[]`.
   */
  claimedKeysSaying(
    positions: readonly (readonly string[])[],
    limit: number,
  ): Promise<readonly HandleKey[]>;
}
