import fc from "fast-check";

import { curatedEmojiSet } from "../emoji/emoji-name";

import { canonicalAliasOf, resolveAlias } from "./alias";

/**
 * Properties of the word alias.
 *
 * **Containment alone would be satisfied by a resolver that returns
 * everything**, which is the same trap `canonicalise.property.test.ts` records
 * about round-trip stability: it catches over-strictness and never catches
 * collapse. So each property below asserts the candidate set **exactly** —
 * every Handle the terms name, and nothing else — which is what a "candidate
 * set rather than a guess" means. A resolver that returned only the first
 * reading, or the whole released set, fails on cardinality.
 */

function slug(term: string): string {
  return term
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The emoji a term slug names, computed here from the curated data rather than
 * read off the resolver's own index.
 */
function emojiNamedBy(term: string): readonly string[] {
  return curatedEmojiSet
    .filter((entry) =>
      [entry.displayName, entry.spokenName, entry.plural, ...entry.synonyms]
        .map(slug)
        .includes(term),
    )
    .map((entry) => entry.emoji);
}

/** Every Handle three term slugs name, in position order. */
function expectedKeys(terms: readonly [string, string, string]): string[] {
  const keys: string[] = [];
  for (const first of emojiNamedBy(terms[0])) {
    for (const second of emojiNamedBy(terms[1])) {
      for (const third of emojiNamedBy(terms[2])) {
        keys.push(`${first}${second}${third}`);
      }
    }
  }
  return keys;
}

const curatedCodePoint = fc.constantFrom(
  ...curatedEmojiSet.map((entry) => entry.emoji),
);

const handleTriple = fc.tuple(
  curatedCodePoint,
  curatedCodePoint,
  curatedCodePoint,
);

/** Any curated term of any released emoji, as a slug. */
const termSlug = fc.constantFrom(
  ...curatedEmojiSet.flatMap((entry) =>
    [entry.displayName, entry.spokenName, entry.plural, ...entry.synonyms].map(
      slug,
    ),
  ),
);

describe("the canonical alias of a Handle", () => {
  it("resolves to a set that holds that Handle", () => {
    fc.assert(
      fc.property(handleTriple, (triple) => {
        const alias = canonicalAliasOf(triple);
        expect(alias).toBeDefined();
        if (alias === undefined) return;

        const result = resolveAlias(alias);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.candidates.map((candidate) => candidate.key)).toContain(
          triple.join(""),
        );
      }),
    );
  });

  it("resolves to every Handle its display names name, and to nothing else", () => {
    fc.assert(
      fc.property(handleTriple, (triple) => {
        const alias = canonicalAliasOf(triple);
        if (alias === undefined) return;
        const result = resolveAlias(alias);
        if (!result.ok) return;

        const terms = alias.split(".");
        const [first, second, third] = terms;
        expect(terms).toHaveLength(3);
        if (
          first === undefined ||
          second === undefined ||
          third === undefined
        ) {
          return;
        }

        expect(result.candidates.map((candidate) => candidate.key)).toEqual(
          expectedKeys([first, second, third]),
        );
      }),
    );
  });
});

describe("any three curated terms", () => {
  it("resolve to exactly the Handles they name, in every position", () => {
    fc.assert(
      fc.property(termSlug, termSlug, termSlug, (first, second, third) => {
        const result = resolveAlias(`${first}.${second}.${third}`);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const expected = expectedKeys([first, second, third]);
        expect(result.candidates).toHaveLength(expected.length);
        expect(result.candidates.map((candidate) => candidate.key)).toEqual(
          expected,
        );
      }),
    );
  });

  it("carry the curated entry for each position, in order", () => {
    fc.assert(
      fc.property(handleTriple, (triple) => {
        const alias = canonicalAliasOf(triple);
        if (alias === undefined) return;
        const result = resolveAlias(alias);
        if (!result.ok) return;

        for (const candidate of result.candidates) {
          expect(candidate.emoji.map((entry) => entry.emoji).join("")).toBe(
            candidate.key,
          );
          expect(candidate.encoded).toBe(encodeURIComponent(candidate.key));
        }
      }),
    );
  });
});
