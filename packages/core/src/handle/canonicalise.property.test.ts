import fc from "fast-check";

import { candidateEmojiSet, releasedEmojiSet } from "../emoji/emoji-set";

import { canonicalise, HANDLE_LENGTH } from "./canonicalise";

/**
 * Property-based tests for the canonical key.
 *
 * The `UNIQUE` index on the key is byte equality, so it only means what
 * ADR-0004 intends if canonicalisation is a **function** in both directions:
 * every spelling of one Handle must give one key (or the index rejects a
 * Handle its owner already holds), and two different Handles must never give
 * the same key (or the index rejects a Handle nobody holds — the failure that
 * actually loses a Claim). Round-trip stability alone catches only the first.
 */

const VS15 = "\u{FE0E}";
const VS16 = "\u{FE0F}";

/**
 * The two **canonically** equivalent forms. NFKC and NFKD are deliberately not
 * spellings of a Handle: compatibility normalisation rewrites 13 of the 1,053
 * candidates into plain CJK characters (U+1F233 🈳 becomes U+7A7A 空), so it
 * destroys the emoji rather than respelling it. ADR-0004 decision 1 says NFC,
 * and `canonicalise.test.ts` pins that distinction with an example. NFC and
 * NFD are both the identity over every candidate, which is what makes them
 * interchangeable spellings here.
 */
type NormalisationForm = "NFC" | "NFD";
type Encoding = "raw" | "percent-encoded" | "lower-case-percent-encoded";

interface Spelling {
  readonly selectors: readonly [string, string, string];
  readonly form: NormalisationForm;
  readonly encoding: Encoding;
}

/** The plainest spelling: raw code points, NFC, no selectors, not encoded. */
const RAW: Spelling = {
  selectors: ["", "", ""],
  form: "NFC",
  encoding: "raw",
};

const releasedCodePoint = fc.constantFrom(
  ...releasedEmojiSet.map((entry) => entry.emoji),
);

const unreleasedCodePoint = fc.constantFrom(
  ...candidateEmojiSet
    .filter((entry) => !entry.released)
    .map((entry) => entry.emoji),
);

/** A Handle as the product thinks of it: three released code points, in order. */
const handleTriple = fc.tuple(
  releasedCodePoint,
  releasedCodePoint,
  releasedCodePoint,
);

/** The six orderings of three positions. */
const PERMUTATIONS: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

const permutation = fc.constantFrom(...PERMUTATIONS);

/**
 * Read one position of a fixed-length triple. `noUncheckedIndexedAccess` types
 * a numeric index as possibly `undefined`, and a type assertion would only
 * hide that — so the impossible case is a thrown error rather than a cast.
 */
function at(triple: readonly [string, string, string], index: number): string {
  const codePoint = triple[index];
  if (codePoint === undefined) {
    throw new Error(`no code point at position ${String(index)}`);
  }
  return codePoint;
}

function reorder(
  triple: readonly [string, string, string],
  order: readonly [number, number, number],
): [string, string, string] {
  return [at(triple, order[0]), at(triple, order[1]), at(triple, order[2])];
}

/**
 * One of the ways a real client can spell that Handle: a keyboard may add a
 * presentation selector per emoji, a client may normalise, and a browser
 * always percent-encodes the path (with hex case unspecified).
 */
const spelling: fc.Arbitrary<Spelling> = fc.record({
  selectors: fc.tuple(
    fc.constantFrom("", VS15, VS16),
    fc.constantFrom("", VS15, VS16),
    fc.constantFrom("", VS15, VS16),
  ),
  form: fc.constantFrom<NormalisationForm[]>("NFC", "NFD"),
  encoding: fc.constantFrom<Encoding[]>(
    "raw",
    "percent-encoded",
    "lower-case-percent-encoded",
  ),
});

function applyEncoding(value: string, encoding: Encoding): string {
  if (encoding === "raw") {
    return value;
  }
  const encoded = encodeURIComponent(value);
  return encoding === "percent-encoded" ? encoded : encoded.toLowerCase();
}

function spell(
  triple: readonly [string, string, string],
  { selectors, form, encoding }: Spelling,
): string {
  const [first, second, third] = triple;
  const [afterFirst, afterSecond, afterThird] = selectors;
  const written =
    `${first}${afterFirst}${second}${afterSecond}${third}${afterThird}`.normalize(
      form,
    );
  return applyEncoding(written, encoding);
}

function keyOf(triple: readonly [string, string, string]): string {
  return triple.join("");
}

function countCodePoints(value: string): number {
  // `Array.from` drives the string iterator, so this counts code points, not
  // UTF-16 units — and it is not spread syntax, so `no-misused-spread` is happy.
  return Array.from(value).length;
}

describe("the canonical key, as a property", () => {
  it("is the bare code-point sequence, whatever the spelling", () => {
    fc.assert(
      fc.property(handleTriple, spelling, (triple, howItIsWritten) => {
        const result = canonicalise(spell(triple, howItIsWritten));

        expect(result).toMatchObject({ ok: true, key: keyOf(triple) });
      }),
      { numRuns: 500 },
    );
  });

  it("never collapses two different Handles onto one key", () => {
    // The property the UNIQUE index actually needs. Two independently drawn
    // triples almost never collide by chance, so this alone is weak — the two
    // properties below attack collapse where it would really happen: a
    // reordering, and a one-position change.
    fc.assert(
      fc.property(handleTriple, handleTriple, (left, right) => {
        fc.pre(keyOf(left) !== keyOf(right));

        const leftResult = canonicalise(spell(left, RAW));
        const rightResult = canonicalise(spell(right, RAW));

        if (!leftResult.ok || !rightResult.ok) {
          throw new Error("expected two Handles from two released triples");
        }
        expect(leftResult.key).not.toBe(rightResult.key);
      }),
      { numRuns: 500 },
    );
  });

  it("keeps order: a reordered Handle is a different Handle (CONTEXT.md)", () => {
    // Two Handles differ if their emoji *or their order* differ. A key built by
    // sorting or from a set would pass every round-trip test and collapse these.
    fc.assert(
      fc.property(handleTriple, permutation, spelling, (triple, order, how) => {
        const reordered = reorder(triple, order);
        fc.pre(keyOf(reordered) !== keyOf(triple));

        const original = canonicalise(spell(triple, how));
        const swapped = canonicalise(spell(reordered, how));

        if (!original.ok || !swapped.ok) {
          throw new Error("expected two Handles from two released triples");
        }
        expect(swapped.key).not.toBe(original.key);
      }),
      { numRuns: 500 },
    );
  });

  it("keeps every position: changing one emoji changes the key", () => {
    fc.assert(
      fc.property(
        handleTriple,
        fc.integer({ min: 0, max: HANDLE_LENGTH - 1 }),
        releasedCodePoint,
        (triple, position, replacement) => {
          fc.pre(triple[position] !== replacement);
          const changed: [string, string, string] = [...triple];
          changed[position] = replacement;

          const before = canonicalise(spell(triple, RAW));
          const after = canonicalise(spell(changed, RAW));

          if (!before.ok || !after.ok) {
            throw new Error("expected two Handles from two released triples");
          }
          expect(after.key).not.toBe(before.key);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("is a fixed point: canonicalising the canonical form changes nothing", () => {
    fc.assert(
      fc.property(handleTriple, spelling, (triple, howItIsWritten) => {
        const first = canonicalise(spell(triple, howItIsWritten));
        if (!first.ok) {
          throw new Error("expected a Handle from a released triple");
        }

        const again = canonicalise(first.encoded);

        expect(again).toMatchObject({
          ok: true,
          key: first.key,
          encoded: first.encoded,
          isCanonical: true,
        });
      }),
      { numRuns: 500 },
    );
  });

  it("holds exactly three code points and no variation selector", () => {
    fc.assert(
      fc.property(handleTriple, spelling, (triple, howItIsWritten) => {
        const result = canonicalise(spell(triple, howItIsWritten));
        if (!result.ok) {
          throw new Error("expected a Handle from a released triple");
        }

        expect(countCodePoints(result.key)).toBe(HANDLE_LENGTH);
        expect(result.key).not.toContain(VS15);
        expect(result.key).not.toContain(VS16);
        expect(result.emoji).toHaveLength(HANDLE_LENGTH);
      }),
      { numRuns: 500 },
    );
  });

  it("calls the received segment canonical only when it is the encoded key", () => {
    fc.assert(
      fc.property(handleTriple, spelling, (triple, howItIsWritten) => {
        const received = spell(triple, howItIsWritten);
        const result = canonicalise(received);
        if (!result.ok) {
          throw new Error("expected a Handle from a released triple");
        }

        expect(result.isCanonical).toBe(received === result.encoded);
      }),
      { numRuns: 500 },
    );
  });

  it("rejects any triple containing an unreleased emoji, with that reason", () => {
    fc.assert(
      fc.property(
        handleTriple,
        unreleasedCodePoint,
        fc.integer({ min: 0, max: HANDLE_LENGTH - 1 }),
        spelling,
        (triple, unreleased, position, howItIsWritten) => {
          const spoiled: [string, string, string] = [...triple];
          spoiled[position] = unreleased;

          const result = canonicalise(spell(spoiled, howItIsWritten));

          expect(result).toMatchObject({
            ok: false,
            reason: "unreleased-category",
            codepoint: unreleased,
          });
        },
      ),
      { numRuns: 500 },
    );
  });

  it("rejects a Handle of any length but three", () => {
    fc.assert(
      fc.property(
        fc.array(releasedCodePoint, { minLength: 0, maxLength: 8 }),
        (codePoints) => {
          fc.pre(codePoints.length !== HANDLE_LENGTH);

          const result = canonicalise(codePoints.join(""));

          expect(result).toEqual({
            ok: false,
            reason: "wrong-length",
            length: codePoints.length,
          });
        },
      ),
      { numRuns: 300 },
    );
  });

  it("never throws, whatever arbitrary text arrives in the path", () => {
    // Percent-encoded garbage is the realistic hostile input: the page must
    // get a rejection it can 404, not a URIError.
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(() => canonicalise(text)).not.toThrow();
      }),
      { numRuns: 1000 },
    );
  });
});
