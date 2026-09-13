import { countSaidBy, SPOKEN_LIST_JOINER } from "../emoji/spoken-handle";

import { ALIAS_SEPARATOR, canonicalAliasOf, resolveAlias } from "./alias";
import { HANDLE_LENGTH } from "./canonicalise";

/**
 * Finding a Handle from the words somebody typed
 * ([#200](https://github.com/joshstothard/3moji/issues/200)).
 *
 * A listener who hears "ice cube, ice cube, ice cube" types words, not the
 * alias grammar. ADR-0008 records that the term index which resolves an alias
 * is the index that powers this lookup, so **this is not a second resolver**:
 * nothing here maps a word to an emoji. It decides only where the term
 * boundaries fall — and, for the spoken form, how many times each term is
 * said — and hands every reading to `resolveAlias`.
 *
 * Deciding the boundaries is the whole problem. Typed words carry no separator
 * a slug cannot contain, so undotted input has exactly the parse ambiguity
 * ADR-0008 measured in the hyphen-joined grammar: `curry rice wine pizza` is
 * `curry` + `rice wine` + `pizza` **and** `curry rice` + `wine` + `pizza`,
 * which are different Handles. A lookup that chose one would send somebody to
 * the wrong Profile, which the ADR calls worse than asking.
 *
 * The spoken form `spokenHandle` says ("three ice cubes", "two red apples and
 * a green apple") is read too
 * ([#201](https://github.com/joshstothard/3moji/issues/201)). **Only here, in
 * the lookup:** the `/[handle]` path still 404s it, because accepting a spoken
 * grammar as an address would partially supersede ADR-0008 decision 2.
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

  const answers: SpokenAnswer[] = [];
  for (const reading of aliasReadingsOf(input)) {
    const resolution = resolveAlias(reading);
    if (!resolution.ok) continue;
    answers.push({
      alias: reading,
      keys: keySetOf(resolution.candidates.map((candidate) => candidate.key)),
    });
  }
  answers.push(...spokenAnswersOf(input));

  for (const answer of answers) {
    // A reading that names Handles no alias can express is still a reading
    // that disagrees with every alias, so it is not found rather than skipped.
    if (answer.alias === undefined) return { found: false };
    if (found === undefined) {
      found = { alias: answer.alias, keys: answer.keys };
      continue;
    }
    if (found.keys !== answer.keys) return { found: false };
  }

  return found === undefined
    ? { found: false }
    : { found: true, alias: found.alias };
}

/**
 * One resolving reading: the Handles it names, as a sorted key list, and the
 * alias that names exactly those — or `undefined` when no alias does.
 */
interface SpokenAnswer {
  readonly alias: string | undefined;
  readonly keys: string;
}

function keySetOf(keys: readonly string[]): string {
  return [...keys].sort().join(",");
}

/** One part of a spoken list: how many, and the words of the term. */
interface SpokenRun {
  readonly count: number;
  readonly term: string;
}

/**
 * The ways one part of a spoken list can be read: a count word then a term
 * ("three ice cubes", "an ice cube"), or a bare term said once ("chopsticks",
 * which takes no article). Both are offered, because a curated name can begin
 * with a number word ("four leaf clover").
 */
function runsOf(words: readonly string[]): readonly SpokenRun[] {
  const runs: SpokenRun[] = [];
  const [first, ...rest] = words;
  if (first === undefined) return runs;

  const count = countSaidBy(first);
  if (count !== undefined && rest.length > 0) {
    runs.push({ count, term: rest.join("-") });
  }
  runs.push({ count: 1, term: words.join("-") });
  return runs;
}

/**
 * Every way to cut `words` into the parts of a spoken list: one part, or two
 * or three with the last introduced by "and". Commas do not survive slugging,
 * so the boundary between the first two of three parts is every position.
 * "And" inside a curated name ("forks and knives") is just another position.
 */
function spokenPartsOf(
  words: readonly string[],
): readonly (readonly (readonly string[])[])[] {
  const cuts: (readonly string[])[][] = [[words]];
  for (const [at, word] of words.entries()) {
    if (word !== SPOKEN_LIST_JOINER || at === 0 || at === words.length - 1) {
      continue;
    }
    const head = words.slice(0, at);
    const last = words.slice(at + 1);
    cuts.push([head, last]);
    for (let second = 1; second < head.length; second += 1) {
      cuts.push([head.slice(0, second), head.slice(second), last]);
    }
  }
  return cuts;
}

/** Every combination of one run per part, in part order. */
function runSequencesOf(
  parts: readonly (readonly string[])[],
): readonly (readonly SpokenRun[])[] {
  let sequences: SpokenRun[][] = [[]];
  for (const part of parts) {
    const runs = runsOf(part);
    sequences = sequences.flatMap((prefix) =>
      runs.map((run) => [...prefix, run]),
    );
  }
  return sequences;
}

/**
 * What one sequence of runs names, if it names anything.
 *
 * **Still not a second resolver.** The runs are spelled out as an alias — "two
 * red apples and a green apple" is `red-apples.red-apples.green-apple` — and
 * `resolveAlias` names the candidates. What the alias cannot say is that a run
 * is one emoji repeated, so candidates whose run positions differ are dropped:
 * "three apple" means 🍎🍎🍎 or 🍏🍏🍏, never 🍎🍏🍎.
 *
 * The answer's alias must name **exactly** what was said, or the visitor would
 * land on a listing of Handles nobody spoke. The spelled-out alias does when
 * nothing was dropped; a single Handle also has its canonical alias to try.
 * Otherwise the answer carries no alias, and the lookup finds nothing.
 */
function answerOf(runs: readonly SpokenRun[]): SpokenAnswer | undefined {
  const total = runs.reduce((sum, run) => sum + run.count, 0);
  if (total !== HANDLE_LENGTH) return undefined;

  const terms = runs.flatMap((run) =>
    Array.from({ length: run.count }, () => run.term),
  );
  const spelled = terms.join(ALIAS_SEPARATOR);
  const resolution = resolveAlias(spelled);
  if (!resolution.ok) return undefined;

  const said = resolution.candidates.filter((candidate) => {
    let position = 0;
    return runs.every((run) => {
      const first = candidate.emoji[position];
      const same = candidate.emoji
        .slice(position, position + run.count)
        .every((entry) => entry === first);
      position += run.count;
      return same;
    });
  });
  if (said.length === 0) return undefined;

  const keys = keySetOf(said.map((candidate) => candidate.key));

  // A single Handle goes to the alias the product publishes when that alias
  // names it alone: "three ice cubes" lands on `ice-cube.ice-cube.ice-cube`.
  const [only] = said;
  if (said.length === 1 && only !== undefined) {
    const canonical = canonicalAliasOf(only.emoji.map((entry) => entry.emoji));
    if (canonical !== undefined && exactlyNames(canonical, keys)) {
      return { alias: canonical, keys };
    }
  }
  if (said.length === resolution.candidates.length) {
    return { alias: spelled, keys };
  }
  return { alias: undefined, keys };
}

function exactlyNames(alias: string, keys: string): boolean {
  const resolution = resolveAlias(alias);
  return (
    resolution.ok &&
    keySetOf(resolution.candidates.map((candidate) => candidate.key)) === keys
  );
}

/**
 * Every resolving reading of the spoken form `spokenHandle` says — "three ice
 * cubes", "two red apples and a green apple", "a red apple, an ice cube and a
 * pizza" ([#201](https://github.com/joshstothard/3moji/issues/201)).
 *
 * Dotted input has none: a dot is the visitor choosing the alias grammar.
 */
function spokenAnswersOf(input: string): readonly SpokenAnswer[] {
  if (input.length > LOOKUP_MAX_LENGTH || input.includes(ALIAS_SEPARATOR)) {
    return [];
  }

  const words = slugify(input)
    .split("-")
    .filter((word) => word !== "");
  const answers: SpokenAnswer[] = [];
  for (const parts of spokenPartsOf(words)) {
    for (const runs of runSequencesOf(parts)) {
      const answer = answerOf(runs);
      if (answer !== undefined) answers.push(answer);
    }
  }
  return answers;
}
