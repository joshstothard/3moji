import { moveLink } from "./reorder-links";

const list = ["a", "b", "c", "d"] as const;

describe("moving one Link within the list", () => {
  it("takes the Link out and puts it back at the destination, closing the gap", () => {
    expect(moveLink(list, 2, 0)).toEqual(["c", "a", "b", "d"]);
  });

  it("moves a Link later in the list without duplicating it", () => {
    expect(moveLink(list, 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves a Link one place up, which is what the keyboard path asks for", () => {
    expect(moveLink(list, 1, 0)).toEqual(["b", "a", "c", "d"]);
  });

  it("moves a Link one place down", () => {
    expect(moveLink(list, 1, 2)).toEqual(["a", "c", "b", "d"]);
  });

  it("moves a Link to the very end", () => {
    expect(moveLink(list, 0, 3)).toEqual(["b", "c", "d", "a"]);
  });

  it("never mutates the list it was given", () => {
    const original = [...list];
    moveLink(original, 3, 0);
    expect(original).toEqual(["a", "b", "c", "d"]);
  });

  it("answers with the same list when the move changes nothing", () => {
    expect(moveLink(list, 2, 2)).toBe(list);
  });

  it.each([
    ["before the first", 0, -1],
    ["past the last", 3, 4],
    ["from before the first", -1, 0],
    ["from past the last", 4, 0],
  ])(
    "refuses a move %s, answering with the list unchanged",
    (_why, from, to) => {
      expect(moveLink(list, from, to)).toBe(list);
    },
  );

  it("refuses a fractional index rather than inventing a hole", () => {
    expect(moveLink(list, 1.5, 0)).toBe(list);
  });

  it("has nothing to do to an empty list", () => {
    const empty: readonly string[] = [];
    expect(moveLink(empty, 0, 0)).toBe(empty);
  });

  it("carries whole Links, not just their titles", () => {
    const links = [
      { title: "Home", url: "https://a.example" },
      { title: "Shop", url: "https://b.example" },
    ] as const;
    expect(moveLink(links, 1, 0)).toEqual([
      { title: "Shop", url: "https://b.example" },
      { title: "Home", url: "https://a.example" },
    ]);
  });
});
