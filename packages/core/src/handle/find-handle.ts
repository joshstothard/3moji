import { ALIAS_SEPARATOR, resolveAlias } from "./alias";
import { HANDLE_LENGTH } from "./canonicalise";

/**
 * Finding a Handle from the words somebody typed
 * ([#200](https://github.com/joshstothard/3moji/issues/200)).
 *
 * A listener who hears "ice cube, ice cube, ice cube" types words, not the
 * alias grammar. ADR-0008 records that the term index which resolves an alias
 * is the index that powers this lookup, so **this is not a second resolver**:
 * nothing here maps a word to an emoji. It decides only where the term
 * boundaries fall, and hands every reading to `resolveAlias`.
 *
 * Deciding the boundaries is the whole problem. Typed words carry no separator
 * a slug cannot contain, so undotted input has exactly the parse ambiguity
 * ADR-0008 measured in the hyphen-joined grammar: `curry rice wine pizza` is
 * `curry` + `rice wine` + `pizza` **and** `curry rice` + `wine` + `pizza`,
 * which are different Handles. A lookup that chose one would send somebody to
 * the wrong Profile, which the ADR calls worse than asking.
 *
 * The spoken form (`three ice cubes`) is deliberately not read here; that is
 * [#201](https://github.com/joshstothard/3moji/issues/201).
 */

/**
 * The longest input the lookup reads. Far beyond ADR-0008's longest canonical
 * alias (74 characters), and it bounds the partitions tried: a word needs at
 * least two characters with its separator, so at most 100 words and C(99, 2)
 * readings, each a map lookup.
 */
export const LOOKUP_MAX_LENGTH = 200;

/** What typed words find: one alias path to go to, or nothing. */
export type HandleLookup =
  { readonly found: true; readonly alias: string } | { readonly found: false };

/**
 * The alias slug rule: lowercase, every run of non-alphanumerics a hyphen.
 * Repeated from `alias.ts` rather than exported from it, for the reason that
 * module gives for its own `decodeOnce`: the resolver's grammar stays whole.
 * `resolveAlias` slugs every part again, so a drift here can only produce a
 * reading that does not resolve, never a different Handle.
 */
function slugify(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Every way to cut `words` into three contiguous, non-empty terms. */
function partitionsOf(words: readonly string[]): readonly string[] {
  const readings: string[] = [];
  for (let first = 1; first <= words.length - 2; first += 1) {
    for (let second = first + 1; second <= words.length - 1; second += 1) {
      readings.push(
        [words.slice(0, first), words.slice(first, second), words.slice(second)]
          .map((term) => term.join("-"))
          .join(ALIAS_SEPARATOR),
      );
    }
  }
  return readings;
}

/**
 * Every alias string the typed text could mean, in a deterministic order.
 *
 * - **A dot is the visitor saying where the terms end**, as it is in the
 *   grammar, so dotted input has exactly one reading: its three parts, slugged.
 *   Any other number of parts, or an empty one, has none.
 * - **Without a dot, every other separator is alike** — spaces, hyphens,
 *   commas, underscores — because a hyphen inside a typed term is
 *   indistinguishable from one between terms. Every cut into three terms is a
 *   reading, the first term shortest first.
 *
 * Pure text in, text out: whether a reading names anything is `resolveAlias`'s
 * answer, not this function's.
 */
export function aliasReadingsOf(input: string): readonly string[] {
  if (input.length > LOOKUP_MAX_LENGTH) return [];

  if (input.includes(ALIAS_SEPARATOR)) {
    const parts = input.split(ALIAS_SEPARATOR).map(slugify);
    if (parts.length !== HANDLE_LENGTH || parts.includes("")) return [];
    return [parts.join(ALIAS_SEPARATOR)];
  }

  const words = slugify(input)
    .split("-")
    .filter((word) => word !== "");
  return partitionsOf(words);
}

/**
 * Where typed words should take a visitor: the alias path, or nowhere.
 *
 * **Found only when every reading that resolves names the same Handles.** Then
 * the first such reading is the path, and its page decides the rest exactly as
 * it does for a pasted link — a Profile, a listing, the claim call to action —
 * so the lookup reveals nothing a visitor could not learn by visiting it. When
 * two readings name different Handles, no one alias says what was typed, and
 * the honest answer is "not found", with the visitor free to add dots.
 *
 * Never throws: each reading is plain slug text, and `resolveAlias` answers
 * malformed input with a rejection rather than an exception.
 */
export function findHandleAlias(input: string): HandleLookup {
  let found: { readonly alias: string; readonly keys: string } | undefined;

  for (const reading of aliasReadingsOf(input)) {
    const resolution = resolveAlias(reading);
    if (!resolution.ok) continue;

    const keys = resolution.candidates
      .map((candidate) => candidate.key)
      .join(",");
    if (found === undefined) {
      found = { alias: reading, keys };
      continue;
    }
    if (found.keys !== keys) return { found: false };
  }

  return found === undefined
    ? { found: false }
    : { found: true, alias: found.alias };
}
