/**
 * The eight Unicode groups the Emoji Set candidate list spans.
 *
 * The list itself is pinned to Emoji 12.0 and is immutable
 * ([ADR-0005](../../../../docs/adr/0005-the-emoji-set.md)); these are the
 * groups Unicode assigns to it, used as the unit a drop is released in
 * ([ADR-0007](../../../../docs/adr/0007-release-the-emoji-set-in-category-drops.md)).
 */
export const EMOJI_CATEGORIES = [
  "Activities",
  "Animals & Nature",
  "Food & Drink",
  "Objects",
  "People & Body",
  "Smileys & Emotion",
  "Symbols",
  "Travel & Places",
] as const;

/** One Unicode group of the Emoji Set candidate list. */
export type EmojiCategory = (typeof EMOJI_CATEGORIES)[number];

/**
 * The released categories — the only emoji a Handle may use.
 *
 * **This list is the drop.** ADR-0007 decision 5 releases categories as data,
 * not code: the next drop is a line added here plus a curation pass, reviewable
 * in a pull request. Decision 6 forbids the reverse — a released category is
 * never withdrawn, because withdrawing one could orphan a claimed Handle.
 *
 * Launch releases Food & Drink (113), Animals & Nature (126) and Activities
 * (68): 307 emoji, giving 28,934,443 three-emoji Handles. Objects is deferred
 * pending curation; Smileys & Emotion, People & Body, Travel & Places and
 * Symbols are not scheduled.
 */
export const RELEASED_CATEGORIES: readonly EmojiCategory[] = [
  "Food & Drink",
  "Animals & Nature",
  "Activities",
];

/** Whether emoji in `category` are claimable. */
export function isCategoryReleased(category: EmojiCategory): boolean {
  return RELEASED_CATEGORIES.includes(category);
}
