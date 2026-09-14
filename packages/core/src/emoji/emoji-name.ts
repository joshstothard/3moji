import type { EmojiArticle } from "./emoji-curation";
import { EMOJI_CURATION } from "./emoji-curation";
import type { EmojiSetEntry } from "./emoji-set";
import { releasedEmojiSet } from "./emoji-set";

/**
 * One released emoji with its curated names resolved onto it.
 *
 * This extends `EmojiSetEntry` rather than replacing it: the CLDR `spokenName`
 * stays on the entry, immutable and reconcilable with Unicode, and the curated
 * fields sit beside it (ADR-0005 decisions 2 and 3). `EmojiSetEntry` itself is
 * deliberately left alone — the generated candidate data is asserted against
 * Unicode's report entry for entry, so the curated layer is a new collection
 * rather than a wider shape.
 */
export interface CuratedEmoji extends EmojiSetEntry {
  /** What the product says and shows. Defaults to the CLDR `spokenName`. */
  readonly displayName: string;
  /** The stored plural of `displayName`. */
  readonly plural: string;
  /** Search-only alternatives. May be empty. */
  readonly synonyms: readonly string[];
  /** Which indefinite article `displayName` takes, if any. */
  readonly article: EmojiArticle;
  /**
   * The canonical word alias's term for this emoji where its `displayName`
   * slug also names another emoji (ADR-0011). Absent everywhere else.
   */
  readonly aliasName?: string;
}

/**
 * The default article: "an" before a vowel letter, "a" otherwise.
 *
 * Spelling is a good enough proxy for pronunciation across this set, but not a
 * perfect one — "a unicorn" and "a ewe" both start with a vowel letter and a
 * consonant sound. Those rows carry an explicit `article` instead of relying on
 * this.
 */
function defaultArticle(displayName: string): EmojiArticle {
  return /^[aeiou]/i.test(displayName) ? "an" : "a";
}

function toCurated(entry: EmojiSetEntry): CuratedEmoji | undefined {
  const curation = EMOJI_CURATION[entry.emoji];
  if (curation === undefined) {
    return undefined;
  }

  const displayName = curation.displayName ?? entry.spokenName;
  return {
    ...entry,
    displayName,
    plural: curation.plural,
    synonyms: curation.synonyms ?? [],
    article: curation.article ?? defaultArticle(displayName),
    // Spread only when set, so the other 302 entries carry no `aliasName` key.
    ...(curation.aliasName === undefined
      ? {}
      : { aliasName: curation.aliasName }),
  };
}

function isCurated(entry: CuratedEmoji | undefined): entry is CuratedEmoji {
  return entry !== undefined;
}

/**
 * The released Emoji Set with its curated names, in candidate-list order.
 *
 * An entry with no curated row is absent rather than half-filled: there is no
 * sensible default for a plural, and `emoji-curation.test.ts` asserts the row
 * set covers the released set exactly, so a gap is red rather than quiet.
 */
export const curatedEmojiSet: readonly CuratedEmoji[] = releasedEmojiSet
  .map(toCurated)
  .filter(isCurated);

const byCodepoint: ReadonlyMap<string, CuratedEmoji> = new Map(
  curatedEmojiSet.map((entry) => [entry.emoji, entry]),
);

/**
 * Look a curated emoji up by its code point.
 *
 * Returns `undefined` for an emoji that is not claimable — unlike
 * `findEmojiByCodepoint`, which answers for the whole candidate list. Curation
 * is per-drop, so there is nothing to return for an unreleased category.
 */
export function findCuratedEmoji(codepoint: string): CuratedEmoji | undefined {
  return byCodepoint.get(codepoint);
}

function matches(entry: CuratedEmoji, query: string): boolean {
  if (entry.displayName.toLowerCase().includes(query)) {
    return true;
  }
  if (entry.spokenName.toLowerCase().includes(query)) {
    return true;
  }
  if (entry.plural.toLowerCase().includes(query)) {
    return true;
  }
  return entry.synonyms.some((synonym) =>
    synonym.toLowerCase().includes(query),
  );
}

/**
 * Search the released set by display name, CLDR name, plural or synonym.
 *
 * All four are matched because they answer different questions: the display
 * name is what a picker shows, the CLDR name is what a determined person might
 * know the emoji as, the plural is what someone after two of something types,
 * and the synonyms are the words the curation pass added precisely because
 * none of the others would have been searched for —
 * "ice cube" for 🧊, "aubergine" for 🍆.
 *
 * The plural is matched because substring matching cannot reach it from the
 * singular: `"aubergine".includes("aubergines")` is false, so a search for
 * "aubergines" found nothing at all before it was added.
 *
 * Case-insensitive substring matching, in candidate-list order. A blank query
 * matches nothing rather than everything, so an empty search box does not read
 * as a request for all 307. The emoji picker no longer searches (#253); the
 * header search (#254) is the consumer this is kept for.
 */
export function searchEmoji(query: string): readonly CuratedEmoji[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return [];
  }
  return curatedEmojiSet.filter((entry) => matches(entry, needle));
}
