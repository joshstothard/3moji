import type { CuratedEmoji } from "../emoji/emoji-name";
import { curatedEmojiSet, findCuratedEmoji } from "../emoji/emoji-name";
import { HANDLE_LENGTH } from "./canonicalise";

/**
 * The word alias: a Handle's second address
 * ([ADR-0008](../../../../docs/adr/0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md)).
 *
 * The emoji URL cannot be shared — an autolinker truncates a path at the first
 * non-ASCII byte, so `3moji.me/🧊🧊🧊` in a bio becomes a link to `3moji.me/`
 * with the emoji orphaned beside it. The alias is the ASCII address the same
 * Handle can actually be pasted at: `3moji.me/ice-cube.ice-cube.ice-cube`.
 *
 * **It is a derived lookup, never a stored second identity** (decision 1). The
 * canonical key is still the three-code-point sequence `canonicalise` produces;
 * nothing here is written to a column, and nothing on the write path consults
 * it.
 */

/**
 * The separator, and the whole reason the grammar works.
 *
 * A hyphen is **measurably** ambiguous: slugging collapses every
 * non-alphanumeric run to `-`, so a hyphen-joined form cannot say where one
 * term ends. ADR-0008 swept 44,976 hyphen-joined candidates and found 1,152
 * admitting more than one valid three-emoji reading — `curry-rice-wine-pizza`
 * is `curry` + `rice-wine` + `pizza` _and_ `curry-rice` + `wine` + `pizza`,
 * both three emoji, so ADR-0004's exactly-three rule does not disambiguate.
 *
 * A dot cannot survive slugging, so no term slug contains one and a three-term
 * alias has exactly one reading. `alias.test.ts` asserts that over every
 * indexed slug rather than trusting the argument.
 */
export const ALIAS_SEPARATOR = ".";

/** One Handle an alias could mean. */
export interface AliasCandidate {
  /** The canonical key: the bare three-code-point sequence. */
  readonly key: string;
  /**
   * `encodeURIComponent(key)` — the canonical **emoji** path segment for this
   * Handle. This is what `rel="canonical"` points at, and what an availability
   * read is asked about.
   */
  readonly encoded: string;
  /** The three curated entries, in order, for rendering and Spoken Names. */
  readonly emoji: readonly CuratedEmoji[];
}

/**
 * What an ASCII segment resolves to.
 *
 * **A success is a candidate _set_, not a Handle.** Resolution ambiguity is
 * inherent and must not be papered over: `apple` names both 🍎 and 🍏, so
 * `apple.apple.apple` names eight Handles and picking one of them would be
 * inventing an answer. The count decides the response, and deciding is the
 * caller's job (ADR-0008 decision 4).
 *
 * The two rejections are deliberately different answers, in the same spirit as
 * `canonicalise`'s four:
 *
 * - `not-an-alias` — the segment is not three dot-separated terms at all. Every
 *   ASCII path that is not this grammar lands here, so a caller answers 404.
 * - `unknown-term` — the shape is right and a term is not one we know. Names
 *   the **leftmost** offender, so the answer is a function of the input alone.
 */
export type AliasResolution =
  | { readonly ok: true; readonly candidates: readonly AliasCandidate[] }
  | { readonly ok: false; readonly reason: "not-an-alias" }
  | {
      readonly ok: false;
      readonly reason: "unknown-term";
      readonly term: string;
    };

/**
 * Lowercase, and collapse every run of non-alphanumerics to a hyphen.
 *
 * This is the slug rule of ADR-0008 decision 2, and it is what guarantees the
 * separator cannot appear inside a term: a dot is not alphanumeric, so it
 * becomes a hyphen like any other punctuation.
 */
function slugify(term: string): string {
  return term
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Every term of one emoji: what the product shows, what Unicode calls it, the
 * plural, and the synonyms the curation pass added.
 *
 * All four are accepted **on input**, which is what makes the shorter
 * `apple.apple.apple` resolve at all (decision 3). Only the `displayName` is
 * canonical on output.
 */
function termsOf(entry: CuratedEmoji): readonly string[] {
  return [
    entry.displayName,
    entry.spokenName,
    entry.plural,
    ...entry.synonyms,
  ].map(slugify);
}

/**
 * The term index: every curated term slug to the emoji it names, in
 * candidate-list order.
 *
 * 937 distinct slugs over 307 emoji, 907 of them naming exactly one — measured
 * in ADR-0008 and re-measured by `alias.test.ts` against the curated data. It
 * is built once at module load, from frozen data, so resolving is a map lookup
 * and no I/O.
 */
const byTerm: ReadonlyMap<string, readonly CuratedEmoji[]> = (() => {
  const index = new Map<string, CuratedEmoji[]>();
  for (const entry of curatedEmojiSet) {
    for (const term of new Set(termsOf(entry))) {
      const named = index.get(term);
      if (named === undefined) {
        index.set(term, [entry]);
        continue;
      }
      named.push(entry);
    }
  }
  return index;
})();

/**
 * Every term slug an alias position accepts.
 *
 * Exported because it is the product's word index, not a detail of this
 * module: ADR-0008's consequences note that the map which resolves an alias is
 * the map that powers looking up a Handle you heard.
 */
export function aliasTermSlugs(): readonly string[] {
  return [...byTerm.keys()];
}

/**
 * The one canonical alias of the Handle made of `codepoints`, and a name for
 * **exactly that one Handle** — 🧊🧊🧊 is `ice-cube.ice-cube.ice-cube`.
 *
 * This is what the product publishes, copies and prints (ADR-0008 decision 3).
 * Each position is the **curated** display name's slug, which is why 🍆 gives
 * `aubergine` and not `eggplant`, and why a curated rename is a breaking URL
 * change.
 *
 * **Unless that slug also names another emoji**
 * ([ADR-0011](../../../../docs/adr/0011-canonical-word-aliases-name-one-handle-and-unclaimed-aliases-list-claimable-handles.md)
 * decision 1). `bat` names both 🦇 and 🏓, so `bat.bat.bat` names eight
 * Handles, and a share link built from it would become a listing the moment
 * another of them was claimed. Such a position takes the emoji's curated
 * `aliasName` instead: 🦇🦇🦇 is `bats.bats.bats`. No shorter word is preferred
 * anywhere else (decision 4).
 *
 * A clashing slug with no `aliasName` falls back to the slug rather than to
 * `undefined`, which callers read as "not a claimable emoji". The curation test
 * in `alias.test.ts` is what makes that fallback unreachable.
 *
 * Returns `undefined` if any code point is not a claimable emoji: there is no
 * alias for a Handle that cannot exist, and a partial one would be worse than
 * none — the same rule `spokenHandle` follows.
 */
export function canonicalAliasOf(
  codepoints: readonly string[],
): string | undefined {
  if (codepoints.length !== HANDLE_LENGTH) {
    return undefined;
  }

  const terms: string[] = [];
  for (const codepoint of codepoints) {
    const entry = findCuratedEmoji(codepoint);
    if (entry === undefined) {
      return undefined;
    }
    terms.push(canonicalTermOf(entry));
  }
  return terms.join(ALIAS_SEPARATOR);
}

/** The term one emoji contributes to a canonical alias (ADR-0011 decision 1). */
function canonicalTermOf(entry: CuratedEmoji): string {
  const display = slugify(entry.displayName);
  if (
    (byTerm.get(display)?.length ?? 0) <= 1 ||
    entry.aliasName === undefined
  ) {
    return display;
  }
  return slugify(entry.aliasName);
}

/**
 * Decode the segment exactly once.
 *
 * Deliberately a local copy of `canonicalise`'s `decodeOnce` rather than a
 * shared helper extracted out of it: the emoji path is the product's canonical
 * address and ADR-0008 decision 7 leaves it untouched, so the second grammar
 * carries its own six lines rather than refactoring the first. The **order**
 * matters and matches: decode, then interpret — so `%2E` is a separator here
 * exactly as `%F0%9F%A7%8A` is an emoji there.
 */
function decodeOnce(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/**
 * Every Handle the three positions name, first position varying slowest.
 *
 * The whole product, in a deterministic order derived from the candidate list.
 * The worst measured case is `celebration`, which names four emoji and so
 * yields 64 Handles.
 */
function candidatesOf(
  positions: readonly (readonly CuratedEmoji[])[],
): readonly AliasCandidate[] {
  let combinations: CuratedEmoji[][] = [[]];
  for (const named of positions) {
    combinations = combinations.flatMap((prefix) =>
      named.map((entry) => [...prefix, entry]),
    );
  }
  return combinations.map((emoji) => {
    const key = emoji.map((entry) => entry.emoji).join("");
    return { key, encoded: encodeURIComponent(key), emoji };
  });
}

/**
 * Resolve a received ASCII path segment as a word alias, or say why it is not
 * one.
 *
 * Pure and free of I/O: it answers which Handles the words could mean, never
 * which of them exist. Composing that with the `handle` table — exactly one
 * claimed match renders in place, several are a listing, none is the claim call
 * to action — is the caller's job (ADR-0008 decision 4).
 *
 * @param segment The received path segment, as Next.js gives it — still
 * percent-encoded — or a plain alias string. Not the whole path: a leading `/`
 * would slug into the first term and make it unknown.
 */
export function resolveAlias(segment: string): AliasResolution {
  const decoded = decodeOnce(segment);
  if (decoded === undefined) {
    // Not even text, so not three terms. The caller 404s it either way, and a
    // third rejection reason would be a distinction nothing could act on.
    return { ok: false, reason: "not-an-alias" };
  }

  const parts = decoded.split(ALIAS_SEPARATOR);
  if (parts.length !== HANDLE_LENGTH) {
    return { ok: false, reason: "not-an-alias" };
  }

  const positions: (readonly CuratedEmoji[])[] = [];
  for (const part of parts) {
    const term = slugify(part);
    if (term === "") {
      // An empty position is a malformed alias rather than an unknown word:
      // there is no term here to report as not found.
      return { ok: false, reason: "not-an-alias" };
    }
    const named = byTerm.get(term);
    if (named === undefined) {
      return { ok: false, reason: "unknown-term", term };
    }
    positions.push(named);
  }

  return { ok: true, candidates: candidatesOf(positions) };
}
