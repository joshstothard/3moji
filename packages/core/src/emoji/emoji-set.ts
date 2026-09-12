import type { EmojiCandidate } from "./emoji-candidate";
import { emojiCandidates } from "./emoji-candidates.generated";
import { isCategoryReleased } from "./emoji-category";

/**
 * One emoji of the Emoji Set, with whether it is claimable.
 *
 * `released` is derived from the category rather than stored, so a drop is an
 * edit to `RELEASED_CATEGORIES` and nothing is regenerated. When the render
 * check retires individual emoji, the predicate below narrows — the shape does
 * not change.
 */
export interface EmojiSetEntry extends EmojiCandidate {
  readonly released: boolean;
}

function isReleased(candidate: EmojiCandidate): boolean {
  return isCategoryReleased(candidate.category);
}

function toEntry(candidate: EmojiCandidate): EmojiSetEntry {
  return { ...candidate, released: isReleased(candidate) };
}

/**
 * The whole pinned candidate list, released and unreleased alike.
 *
 * Unreleased entries are present and marked `released: false`: a picker needs
 * to know a category exists before it is claimable, and the drift test needs
 * the list to reconcile against Unicode.
 */
export const candidateEmojiSet: readonly EmojiSetEntry[] =
  emojiCandidates.map(toEntry);

/**
 * The Emoji Set a Handle may draw from: the released categories only
 * ([ADR-0007](../../../../docs/adr/0007-release-the-emoji-set-in-category-drops.md)
 * decision 1).
 */
export const releasedEmojiSet: readonly EmojiSetEntry[] =
  candidateEmojiSet.filter((entry) => entry.released);

const byCodepoint: ReadonlyMap<string, EmojiSetEntry> = new Map(
  candidateEmojiSet.map((entry) => [entry.emoji, entry]),
);

/**
 * Look an emoji up by its code point — the single-character string that
 * splitting a decoded, canonicalised Handle path yields (see
 * `docs/architecture/data-model.md`). `EmojiSetEntry.codepoint` carries the
 * same code point in `U+XXXX` notation; that notation is not a lookup key.
 *
 * Returns an unreleased entry too, so a caller can tell "not an emoji we know"
 * from "not claimable yet". Use `isClaimableEmoji` to decide a Claim.
 */
export function findEmojiByCodepoint(
  codepoint: string,
): EmojiSetEntry | undefined {
  return byCodepoint.get(codepoint);
}

/** Whether a Handle may use this code point. */
export function isClaimableEmoji(codepoint: string): boolean {
  return findEmojiByCodepoint(codepoint)?.released ?? false;
}
