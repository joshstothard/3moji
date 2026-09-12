import type { EmojiCategory } from "./emoji-category";

/**
 * The Emoji version the candidate list is pinned to
 * ([ADR-0005](../../../../docs/adr/0005-the-emoji-set.md) decision 1). Emoji
 * 12.0 renders on iOS 13.2+ and Android 10+; the pin is a yearly review.
 */
export const EMOJI_SET_VERSION = "12.0";

/**
 * One entry of the pinned candidate list, exactly as Unicode gives it.
 *
 * Every field here is derived mechanically from Unicode's own data files, so
 * the set stays reconcilable with upstream. The curated layer that adds
 * `displayName`, `synonyms` and a plural sits on top of this shape rather than
 * replacing it (ADR-0005 decision 3).
 */
export interface EmojiCandidate {
  /** The code point in `U+XXXX` notation, for provenance — e.g. `U+1F34E`. */
  readonly codepoint: string;
  /** The code point itself, as a single-character string — e.g. `🍎`. */
  readonly emoji: string;
  /** The CLDR short name. Canonical identity, and immutable. */
  readonly spokenName: string;
  /** The Unicode group, which is the unit a release drop uses. */
  readonly category: EmojiCategory;
}
