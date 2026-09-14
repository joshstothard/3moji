import type { HandleKey } from "../db/handle-key";
import {
  curatedEmojiSet,
  findCuratedEmoji,
  searchEmoji,
  type CuratedEmoji,
} from "../emoji/emoji-name";
import type { HandleSearchIndex } from "../ports/handle-search-index";
import type { ProfileRepository } from "../ports/profile-repository";
import { canonicalAliasOf, emojiNamedBy } from "./alias";
import { HANDLE_LENGTH } from "./canonicalise";
import {
  RESERVED_HANDLES,
  isReservedHandle,
  type ReservedHandleList,
} from "./reserved-handles";

/**
 * The header search
 * ([ADR-0012](../../../../docs/adr/0012-header-search-lists-claimed-handles-with-display-names-capped-and-rate-limited.md),
 * [#254](https://github.com/joshstothard/3moji/issues/254)): the claimed
 * Handles a query names, with their owners' display names, and the emoji whose
 * curated names it begins.
 *
 * **A metered directory, deliberately small.** A claimed Handle's emoji and
 * display name are already public one Profile at a time; a search makes them
 * findable in bulk, so what it may find is narrow by construction:
 *
 * - **Only the curated term index and emoji are searched** (decision 3). A
 *   word is a complete term slug or nothing, so free text — a display name, a
 *   fragment of one, an email address — cannot reach the database at all.
 * - **Claimed Handles only, never Reserved** (decision 2). The index answers
 *   claimed rows; the Reserved list is checked here, because an addition to it
 *   applies to future Claims only and an earlier Claim can still be in the
 *   table.
 * - **At most {@link SEARCH_HANDLE_LIMIT} Handles and
 *   {@link SEARCH_EMOJI_LIMIT} emoji** (decision 4), and an order with no
 *   popularity or recency in it (decision 5).
 *
 * The rate limit is the route's (`search-rate-limit.ts`), so this function is
 * pure apart from its two reads.
 */

/** Decision 4: the most Handles one response holds. */
export const SEARCH_HANDLE_LIMIT = 5;

/** Decision 4: the most emoji suggestions one response holds. */
export const SEARCH_EMOJI_LIMIT = 8;

/**
 * The most claimed keys one search reads before ordering them.
 *
 * **A bound on the read, not on the answer**, and a limit ADR-0012 does not
 * name. A one-word query such as `apple` matches every claimed Handle holding
 * either apple, and the order of decision 5 is decided here, after the read,
 * so capping the read at five would drop better results. A thousand three-emoji
 * keys is a few kilobytes. Past it, the adapter keeps the first thousand by
 * key, so on a table that large the order would be decided over that subset:
 * recorded as a scale limit to revisit, not a behaviour anybody sees at launch.
 */
export const SEARCH_READ_LIMIT = 1000;

/** Decision 3: a query is one to three words or emoji. */
export const SEARCH_MAX_TERMS = 3;

/** The longest query read at all, as `/find` bounds its own. */
export const SEARCH_QUERY_MAX_LENGTH = 200;

/** Decision 3: emoji suggestions start at two characters. */
export const EMOJI_SUGGESTION_MIN_LENGTH = 2;

/** One Handle a search found: what the result row draws and links to. */
export interface FoundHandle {
  /** The canonical key, three bare code points. */
  readonly key: string;
  /** Its percent-encoded emoji path segment. */
  readonly encoded: string;
  /** Its canonical word alias ([ADR-0011](../../../../docs/adr/0011-canonical-word-aliases-name-one-handle-and-unclaimed-aliases-list-claimable-handles.md)). */
  readonly alias: string;
  /** The owner's display name, or `null` when none is set. */
  readonly displayName: string | null;
}

/** One emoji a search suggests, by the name the product shows. */
export interface FoundEmoji {
  readonly emoji: string;
  readonly name: string;
}

/** What one search answers. */
export interface HandleSearch {
  readonly handles: readonly FoundHandle[];
  readonly emoji: readonly FoundEmoji[];
}

export interface SearchHandlesInput {
  /** As typed. Never trusted, never logged. */
  readonly query: string;
  readonly index: HandleSearchIndex;
  /** Only the names read: nothing here can look a Profile up by its name. */
  readonly profiles: Pick<ProfileRepository, "displayNamesOf">;
  /** The Reserved Handle list; a parameter so a test can add to it. */
  readonly list?: ReservedHandleList;
}

/** Words are separated by whitespace, commas or the alias dot. */
const SEPARATORS = /[\s,.]+/u;

/** The two presentation selectors, which `canonicalise` strips too. */
const PRESENTATION_SELECTORS = /[︎️]/gu;

type SearchTerm = readonly CuratedEmoji[];

function isCurated(entry: CuratedEmoji | undefined): entry is CuratedEmoji {
  return entry !== undefined;
}

/**
 * One typed token as terms: a run of claimable emoji is one term per emoji,
 * and anything else must be one complete term slug.
 */
function termsOfToken(token: string): readonly SearchTerm[] | undefined {
  const bare = token.replace(PRESENTATION_SELECTORS, "");
  const asEmoji = Array.from(bare).map(findCuratedEmoji);
  if (asEmoji.every(isCurated)) {
    return asEmoji.map((entry) => [entry]);
  }
  const named = emojiNamedBy(bare);
  return named === undefined ? undefined : [named];
}

/**
 * The terms a query searches for — each the emoji one word or one typed emoji
 * names — or `undefined` when the query searches for no Handle at all.
 *
 * `undefined` for any word that is not a complete term slug or a claimable
 * emoji, for more than three terms, for none, and for a query over
 * {@link SEARCH_QUERY_MAX_LENGTH} characters. There is no partial answer: a
 * query with one unknown word finds no Handles rather than ignoring the word,
 * which is what keeps free text out of the read.
 */
export function searchTermsOf(
  query: string,
): readonly SearchTerm[] | undefined {
  if (query.length > SEARCH_QUERY_MAX_LENGTH) return undefined;

  const tokens = query
    .normalize("NFC")
    .split(SEPARATORS)
    .filter((token) => token !== "");
  if (tokens.length === 0) return undefined;

  const terms: SearchTerm[] = [];
  for (const token of tokens) {
    const found = termsOfToken(token);
    if (found === undefined) return undefined;
    terms.push(...found);
    if (terms.length > SEARCH_MAX_TERMS) return undefined;
  }
  return terms;
}

/** Whether `needle` begins `name` or one of its words. */
function beginsAWordOf(name: string, needle: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.startsWith(needle) ||
    lower.includes(` ${needle}`) ||
    lower.includes(`-${needle}`)
  );
}

/**
 * The emoji whose curated names the query begins, at most
 * {@link SEARCH_EMOJI_LIMIT}, in candidate-list order.
 *
 * **Prefix, not substring** (decision 3): `searchEmoji` matches anywhere in a
 * name, and is kept as it is for its own tests; this narrows its answer to names
 * with a word the query begins, so `gre` suggests the green apple and `pple`
 * suggests nothing. Nothing below {@link EMOJI_SUGGESTION_MIN_LENGTH}
 * characters. The curated names are public product data, which is why they
 * may be prefix-matched when a Handle's words may not.
 */
export function suggestEmoji(query: string): readonly FoundEmoji[] {
  const needle = query.normalize("NFC").trim().toLowerCase();
  if (Array.from(needle).length < EMOJI_SUGGESTION_MIN_LENGTH) return [];

  return searchEmoji(needle)
    .filter((entry) =>
      [
        entry.displayName,
        entry.spokenName,
        entry.plural,
        ...entry.synonyms,
      ].some((name) => beginsAWordOf(name, needle)),
    )
    .slice(0, SEARCH_EMOJI_LIMIT)
    .map((entry) => ({ emoji: entry.emoji, name: entry.displayName }));
}

/**
 * Whether every term can take a position of its own in the Handle — `pizza
 * pizza` needs two pizzas, not one pizza counted twice. Three positions and at
 * most three terms, so trying every assignment is at most six checks.
 */
function fitsDistinctPositions(
  codepoints: readonly string[],
  terms: readonly SearchTerm[],
  taken: readonly boolean[] = codepoints.map(() => false),
): boolean {
  const [term, ...rest] = terms;
  if (term === undefined) return true;
  return codepoints.some(
    (codepoint, position) =>
      taken[position] !== true &&
      term.some((entry) => entry.emoji === codepoint) &&
      fitsDistinctPositions(
        codepoints,
        rest,
        taken.map((was, at) => was || at === position),
      ),
  );
}

/** A Handle that says the whole query, term by term, in order. */
function matchesExactly(
  codepoints: readonly string[],
  terms: readonly SearchTerm[],
): boolean {
  return (
    terms.length === HANDLE_LENGTH &&
    terms.every((term, position) =>
      term.some((entry) => entry.emoji === codepoints[position]),
    )
  );
}

const candidateIndex: ReadonlyMap<string, number> = new Map(
  curatedEmojiSet.map((entry, index) => [entry.emoji, index]),
);

interface RankedHandle {
  readonly key: HandleKey;
  readonly alias: string;
  readonly exact: boolean;
  /** How many positions hold an emoji the query names. */
  readonly queryEmoji: number;
  /** Each position's place in the candidate list. */
  readonly resolverOrder: readonly number[];
}

/**
 * Decision 5, as a comparison: the exact match first, then more of the query's
 * emoji, then the resolver's order.
 *
 * **Resolver order is the candidate list, first position varying slowest** —
 * the order `resolveAlias` gives a three-term alias's candidates. ADR-0012 names
 * it without defining it for one or two terms, where there is no candidate
 * list to take it from, so the same rule is applied position by position.
 */
function byDecisionFive(first: RankedHandle, second: RankedHandle): number {
  if (first.exact !== second.exact) return first.exact ? -1 : 1;
  if (first.queryEmoji !== second.queryEmoji) {
    return second.queryEmoji - first.queryEmoji;
  }
  for (const [position, place] of first.resolverOrder.entries()) {
    const other = second.resolverOrder[position] ?? 0;
    if (place !== other) return place - other;
  }
  return 0;
}

function rank(
  key: HandleKey,
  terms: readonly SearchTerm[],
  list: ReservedHandleList,
): RankedHandle | undefined {
  const codepoints = Array.from(key);
  if (codepoints.length !== HANDLE_LENGTH) return undefined;
  if (!fitsDistinctPositions(codepoints, terms)) return undefined;
  if (isReservedHandle(key, list)) return undefined;

  // A Handle with no canonical alias holds an emoji that is no longer
  // claimable, and a result without one would link nowhere shareable.
  const alias = canonicalAliasOf(codepoints);
  if (alias === undefined) return undefined;

  const named = new Set(
    terms.flatMap((term) => term.map((entry) => entry.emoji)),
  );
  return {
    key,
    alias,
    exact: matchesExactly(codepoints, terms),
    queryEmoji: codepoints.filter((codepoint) => named.has(codepoint)).length,
    resolverOrder: codepoints.map(
      (codepoint) => candidateIndex.get(codepoint) ?? curatedEmojiSet.length,
    ),
  };
}

/**
 * Search: the claimed Handles the query's terms name, ordered and capped, with
 * their display names, and the emoji suggestions.
 *
 * **Display names are read only for the Handles being shown, after they are
 * chosen** — one read, never consulted to decide what matches. That is decision
 * 3's "shown but not searchable", held by the order of the code rather than by
 * a filter somebody could forget.
 *
 * A query that names no Handle reads nothing. A read that fails rejects, and
 * the route answers the failure.
 */
export async function searchHandles(
  input: SearchHandlesInput,
): Promise<HandleSearch> {
  const emoji = suggestEmoji(input.query);
  const terms = searchTermsOf(input.query);
  if (terms === undefined) return { handles: [], emoji };

  const keys = await input.index.claimedKeysContaining(
    terms.map((term) => term.map((entry) => entry.emoji)),
    SEARCH_READ_LIMIT,
  );

  const list = input.list ?? RESERVED_HANDLES;
  const shown = keys
    .map((key) => rank(key, terms, list))
    .filter((ranked): ranked is RankedHandle => ranked !== undefined)
    .sort(byDecisionFive)
    .slice(0, SEARCH_HANDLE_LIMIT);
  if (shown.length === 0) return { handles: [], emoji };

  const names = await input.profiles.displayNamesOf(
    shown.map((ranked) => ranked.key),
  );

  return {
    handles: shown.map((ranked) => ({
      key: ranked.key,
      encoded: encodeURIComponent(ranked.key),
      alias: ranked.alias,
      displayName: names.get(ranked.key) ?? null,
    })),
    emoji,
  };
}
