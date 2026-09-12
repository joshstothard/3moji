import { HANDLE_LENGTH, type CanonicalHandle } from "./canonicalise";
import { claimableHandle } from "./claimable";
import { RESERVED_HANDLES, type ReservedHandleList } from "./reserved-handles";
import { findEmojiByCodepoint, releasedEmojiSet } from "../emoji/emoji-set";

/** One Handle offered in place of a pick somebody else already has. */
export interface SwapSuggestion {
  /** The suggested Handle, canonicalised, so a caller need not do it again. */
  readonly handle: CanonicalHandle;
  /**
   * The zero-based position whose emoji was replaced.
   *
   * Carried because the two things a caller does with a suggestion both need
   * it: say which emoji changed, and put keyboard focus on the slot that
   * changed once the swap is applied. Deriving it by diffing two keys is
   * possible but wrong for a repeated emoji — 🍕🍕🍕 to 🍕🌮🍕 and to 🍕🍕🌮
   * differ from the pick at one position each, and a diff cannot tell which
   * 🍕 the caller should now look at.
   */
  readonly position: number;
}

export interface SwapSuggestionsInput {
  /**
   * The picked emoji, in order. Anything other than {@link HANDLE_LENGTH} of
   * them suggests nothing: there is no Handle to swap against yet.
   */
  readonly emoji: readonly string[];
  /** How many suggestions at most. Defaults to {@link SWAP_SUGGESTION_LIMIT}. */
  readonly limit?: number;
  /**
   * The Reserved Handle list, a parameter for the reason the claim gate takes
   * one: a test proves the filter by adding an entry rather than by trusting
   * today's data to contain a suitable case.
   */
  readonly list?: ReservedHandleList;
}

/** How many suggestions a caller gets unless it asks for another number. */
export const SWAP_SUGGESTION_LIMIT = 3;

/**
 * The released emoji of one emoji's own Unicode group, minus that emoji.
 *
 * The group is the theme axis
 * ([ADR-0005](../../../../docs/adr/0005-the-emoji-set.md) decision 4: colour
 * was considered and rejected because it cannot be derived, so suggestions use
 * the `group` already present in the data — `category` on an Emoji Set entry).
 * Candidate-list order, which is Unicode's, so the result is deterministic.
 *
 * An emoji in an unreleased category has no alternatives: everything in its
 * group is unclaimable, and suggesting one would be a second dead end.
 */
function alternativesTo(emoji: string): readonly string[] {
  const entry = findEmojiByCodepoint(emoji);
  if (!entry?.released) {
    return [];
  }
  return releasedEmojiSet
    .filter((each) => each.category === entry.category && each.emoji !== emoji)
    .map((each) => each.emoji);
}

/**
 * Theme-based alternatives to a Handle somebody else already has.
 *
 * Each suggestion replaces **one** emoji with another from the same Unicode
 * group, so a pick stays recognisably the thing it was: a taken 🍕🍕🍕 offers
 * another Food & Drink triple, not a random one.
 *
 * Three properties are deliberate:
 *
 * - **Deterministic.** Rank-major, position-minor: the first alternative for
 *   each of the three positions, then the second for each, and so on. A random
 *   pick would be a flaky test, and the spread means three suggestions are
 *   three shapes rather than three variations on the first slot.
 * - **Claimable as far as this can tell.** Every suggestion passes
 *   {@link claimableHandle}, so no suggestion carries a blocked emoji or names
 *   a Reserved Handle. That is the whole of what a pure function can promise:
 *   **a suggestion is well-formed and not Reserved, not "provably free"**.
 *   Ownership lives in the `handle` table, and checking it here would be one
 *   database read per suggestion on a path that exists to be instant.
 * - **Pure.** No clock, no repository, no I/O — which is why it can run in the
 *   browser beside the builder that shows it (see `browser.ts`).
 */
export function swapSuggestions(
  input: SwapSuggestionsInput,
): readonly SwapSuggestion[] {
  const {
    emoji,
    limit = SWAP_SUGGESTION_LIMIT,
    list = RESERVED_HANDLES,
  } = input;

  if (emoji.length !== HANDLE_LENGTH || limit <= 0) {
    return [];
  }

  const alternatives = emoji.map(alternativesTo);
  const deepest = Math.max(...alternatives.map((each) => each.length));
  const found: SwapSuggestion[] = [];
  const seen = new Set<string>([emoji.join("")]);

  for (let rank = 0; rank < deepest; rank += 1) {
    for (let position = 0; position < emoji.length; position += 1) {
      if (found.length >= limit) {
        return found;
      }

      const replacement = alternatives[position]?.[rank];
      if (replacement === undefined) {
        continue;
      }

      const candidate = emoji.map((each, index) =>
        index === position ? replacement : each,
      );
      const key = candidate.join("");
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const claimability = claimableHandle(key, list);
      if (claimability.ok) {
        found.push({ handle: claimability.handle, position });
      }
    }
  }

  return found;
}
