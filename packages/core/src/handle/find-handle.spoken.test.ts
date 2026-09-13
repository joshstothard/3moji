import { curatedEmojiSet } from "../emoji/emoji-name";
import { spokenHandle } from "../emoji/spoken-handle";

import { resolveAlias } from "./alias";
import { findHandleAlias } from "./find-handle";

/**
 * Finding a Handle from its spoken form
 * ([#201](https://github.com/joshstothard/3moji/issues/201)).
 *
 * Profiles say "three ice cubes", so that is what a listener types. This is
 * the lookup only: the `/[handle]` path still answers the spoken form with 404,
 * because accepting it there needs an ADR partially superseding ADR-0008.
 *
 * **The claim under test is "never the wrong Handle".** A lookup that found
 * nothing would satisfy it vacuously, so every sweep below also pins how many
 * Handles it finds exactly.
 */

const ICE = "\u{1F9CA}";
const RED_APPLE = "\u{1F34E}";
const GREEN_APPLE = "\u{1F34F}";
const PIZZA = "\u{1F355}";

function keysOf(alias: string): readonly string[] {
  const resolution = resolveAlias(alias);
  if (!resolution.ok) throw new Error(`${alias} does not resolve`);
  return resolution.candidates.map((candidate) => candidate.key);
}

/** What the lookup lands on for `typed`: the Handles its alias names. */
function landsOn(typed: string): readonly string[] | undefined {
  const lookup = findHandleAlias(typed);
  return lookup.found ? keysOf(lookup.alias) : undefined;
}

function spoken(codepoints: readonly string[]): string {
  const said = spokenHandle(codepoints);
  if (said === undefined) throw new Error("not a released Handle");
  return said;
}

describe("findHandleAlias reading the spoken form", () => {
  it.each([
    ["three ice cubes", [ICE, ICE, ICE]],
    ["Three Ice Cubes", [ICE, ICE, ICE]],
    ["3 ice cubes", [ICE, ICE, ICE]],
    ["two red apples and a green apple", [RED_APPLE, RED_APPLE, GREEN_APPLE]],
    ["a red apple, an ice cube and a pizza", [RED_APPLE, ICE, PIZZA]],
    ["a red apple an ice cube and a pizza", [RED_APPLE, ICE, PIZZA]],
    ["an ice cube and two pizzas", [ICE, PIZZA, PIZZA]],
  ])("finds exactly the Handle %p names", (typed, codepoints) => {
    expect(landsOn(typed)).toEqual([codepoints.join("")]);
  });

  it("keeps the order a mixed Handle is said in", () => {
    expect(landsOn("an ice cube, a pizza and an ice cube")).toEqual([
      `${ICE}${PIZZA}${ICE}`,
    ]);
  });

  it("finds nothing when the counts do not add up to three", () => {
    expect(findHandleAlias("two ice cubes")).toEqual({ found: false });
    expect(findHandleAlias("three ice cubes and a pizza")).toEqual({
      found: false,
    });
    expect(findHandleAlias("four ice cubes")).toEqual({ found: false });
  });

  it("finds nothing for spoken words that name no emoji", () => {
    expect(findHandleAlias("three wibbles")).toEqual({ found: false });
  });

  it("finds nothing, rather than a wider listing, when a run's word names several emoji", () => {
    // `apple` names 🍎 and 🍏. "Three apples" means one of them three times,
    // two Handles, but `apple.apple.apple` lists all eight mixes, so no alias
    // says what was spoken and landing on it would show Handles never meant.
    expect(keysOf("apple.apple.apple")).toHaveLength(8);
    expect(findHandleAlias("three apple")).toEqual({ found: false });
  });

  it("still does not read words already inside a name as counts or joiners", () => {
    // "four leaf clover" and "forks and knives" carry a number word and "and"
    // inside the curated name; the spoken reading must not break them apart.
    const clover = curatedEmojiSet.find(
      (entry) => entry.displayName === "four leaf clover",
    );
    const cutlery = curatedEmojiSet.find(
      (entry) => entry.displayName === "fork and knife",
    );
    if (clover === undefined || cutlery === undefined) {
      throw new Error("curated data moved");
    }
    for (const codepoints of [
      [clover.emoji, clover.emoji, clover.emoji],
      [cutlery.emoji, cutlery.emoji, cutlery.emoji],
      [cutlery.emoji, clover.emoji, ICE],
    ]) {
      expect(landsOn(spoken(codepoints))).toEqual([codepoints.join("")]);
    }
  });
});

describe("the spoken form of every released Handle", () => {
  const emoji = curatedEmojiSet.map((entry) => entry.emoji);

  /**
   * Asserts the property over `handles` and returns how many were found as
   * exactly themselves, so each sweep can also pin that it is not vacuous.
   */
  function sweep(handles: readonly (readonly string[])[]): {
    exact: number;
    wrong: string[];
  } {
    let exact = 0;
    const wrong: string[] = [];
    for (const codepoints of handles) {
      const key = codepoints.join("");
      const said = spoken(codepoints);
      const found = landsOn(said);
      if (found === undefined) continue;
      if (!found.includes(key)) {
        wrong.push(`"${said}" -> ${found.join(",")}`);
        continue;
      }
      if (found.length === 1) exact += 1;
    }
    return { exact, wrong };
  }

  it("never lands a three-of-a-kind on a Handle it did not say", () => {
    const { exact, wrong } = sweep(emoji.map((e) => [e, e, e]));

    expect(wrong).toEqual([]);
    // Nearly every three-of-a-kind is found as exactly itself; the rest are
    // plurals another emoji's term shares, which honestly find nothing.
    expect(exact).toBeGreaterThanOrEqual(Math.floor(emoji.length * 0.9));
  });

  it("never lands 'two Xs and a Y' on a Handle it did not say", () => {
    const handles: string[][] = [];
    for (const [i, first] of emoji.entries()) {
      // Every pair would be 94k lookups; a fixed stride over the set covers
      // every emoji in both positions deterministically.
      for (let step = 1; step < emoji.length; step += 7) {
        const second = emoji[(i + step) % emoji.length];
        if (second === undefined) continue;
        handles.push([first, first, second], [second, first, first]);
      }
    }
    const { exact, wrong } = sweep(handles);

    expect(wrong).toEqual([]);
    expect(exact).toBeGreaterThanOrEqual(Math.floor(handles.length * 0.8));
  });

  it("never lands three different emoji on a Handle it did not say", () => {
    const handles: string[][] = [];
    for (const [i, first] of emoji.entries()) {
      for (const offset of [1, 5, 11, 29, 97]) {
        const second = emoji[(i + offset) % emoji.length];
        const third = emoji[(i + offset * 3 + 2) % emoji.length];
        if (second === undefined || third === undefined) continue;
        if (second === first || third === second) continue;
        handles.push([first, second, third]);
      }
    }
    const { exact, wrong } = sweep(handles);

    expect(wrong).toEqual([]);
    expect(exact).toBeGreaterThanOrEqual(Math.floor(handles.length * 0.7));
  });
});
