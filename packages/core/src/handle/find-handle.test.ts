import { resolveAlias } from "./alias";
import {
  aliasReadingsOf,
  findHandleAlias,
  LOOKUP_MAX_LENGTH,
} from "./find-handle";

/**
 * Finding a Handle from the words somebody typed (#200).
 *
 * The lookup is **not a second resolver**: it only decides where the term
 * boundaries fall and hands every reading to `resolveAlias`. These tests
 * assert exact readings and exact outcomes, because a lookup that returned
 * every partition, or accepted anything, would satisfy containment.
 */

const ICE = "\u{1F9CA}";
const ICE_ALIAS = "ice-cube.ice-cube.ice-cube";

function keysOf(alias: string): readonly string[] {
  const resolution = resolveAlias(alias);
  if (!resolution.ok) throw new Error(`${alias} does not resolve`);
  return resolution.candidates.map((candidate) => candidate.key);
}

describe("aliasReadingsOf", () => {
  it("keeps a dotted input as the one reading it spells", () => {
    expect(aliasReadingsOf("Ice Cube. ICE-cube .ice_cube")).toEqual([
      ICE_ALIAS,
    ]);
  });

  it("offers every way to split undotted words into three terms", () => {
    expect(aliasReadingsOf("a b c d")).toEqual([
      "a.b.c-d",
      "a.b-c.d",
      "a-b.c.d",
    ]);
  });

  it("treats spaces, hyphens, commas and case alike when there are no dots", () => {
    expect(aliasReadingsOf("ice-cube ICE, cube  ice_cube")).toEqual(
      aliasReadingsOf("ice cube ice cube ice cube"),
    );
  });

  it("has no reading for fewer than three words", () => {
    expect(aliasReadingsOf("ice cube")).toEqual([]);
    expect(aliasReadingsOf("")).toEqual([]);
    expect(aliasReadingsOf("   ,, -- ")).toEqual([]);
  });

  it("has no reading for a dotted input that is not three parts", () => {
    expect(aliasReadingsOf("ice.ice")).toEqual([]);
    expect(aliasReadingsOf("ice.ice.ice.ice")).toEqual([]);
    expect(aliasReadingsOf("ice..ice")).toEqual([]);
  });

  it("refuses input longer than the lookup accepts", () => {
    const long = `${"a".repeat(LOOKUP_MAX_LENGTH)} ice ice`;
    expect(aliasReadingsOf(long)).toEqual([]);
  });
});

describe("findHandleAlias", () => {
  it.each([
    "ice cube ice cube ice cube",
    "ice-cube.ice-cube.ice-cube",
    "Ice-Cube.Ice-Cube.Ice-Cube",
    "  ICE CUBE, ice cube, Ice Cube  ",
    "ice-cube ice-cube ice-cube",
  ])("finds exactly the ice cube Handle from %p", (typed) => {
    const found = findHandleAlias(typed);

    expect(found).toEqual({ found: true, alias: ICE_ALIAS });
    expect(keysOf(ICE_ALIAS)).toEqual([`${ICE}${ICE}${ICE}`]);
  });

  it("finds an alias that names several Handles, leaving the listing to its page", () => {
    expect(findHandleAlias("apple apple apple")).toEqual({
      found: true,
      alias: "apple.apple.apple",
    });
    expect(keysOf("apple.apple.apple")).toHaveLength(8);
  });

  it("finds nothing for unknown words", () => {
    expect(findHandleAlias("wibble wobble wubble")).toEqual({ found: false });
  });

  it("reads the spoken form with number words (#201)", () => {
    expect(findHandleAlias("three ice cubes")).toEqual({
      found: true,
      alias: ICE_ALIAS,
    });
  });

  it("finds nothing, rather than guessing, when two readings name different Handles", () => {
    // `curry` and `curry rice` both name the curry, and `rice wine` names the
    // sake, so these words spell two different Handles (ADR-0008's parse
    // ambiguity). Redirecting to either would invent an answer.
    const readings = aliasReadingsOf("curry rice wine pizza").filter(
      (reading) => resolveAlias(reading).ok,
    );
    expect(readings).toHaveLength(2);
    expect(keysOf(readings[0] ?? "")).not.toEqual(keysOf(readings[1] ?? ""));

    expect(findHandleAlias("curry rice wine pizza")).toEqual({ found: false });
  });

  it("never throws on input that is not text an alias could be", () => {
    for (const typed of [
      "%",
      "%E0%A4%A",
      "100% ice ice",
      `${ICE}${ICE}${ICE}`,
      String.fromCharCode(0),
    ]) {
      expect(() => findHandleAlias(typed)).not.toThrow();
      expect(findHandleAlias(typed)).toEqual({ found: false });
    }
  });

  it("finds nothing for empty input", () => {
    expect(findHandleAlias("")).toEqual({ found: false });
  });
});
