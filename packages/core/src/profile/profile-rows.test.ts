import { profileFromRows, type JoinedProfileRow } from "./profile-rows";

const UPDATED_AT = new Date("2026-09-12T12:00:00.000Z");

const base = {
  displayName: "A Name",
  bio: "A bio",
  updatedAt: UPDATED_AT,
} as const;

const withLink = (
  id: string,
  title: string,
  position: number,
): JoinedProfileRow => ({
  ...base,
  link: { id, title, url: `https://example.com/${title}`, position },
});

describe("profileFromRows", () => {
  it("is undefined when the join matched nothing", () => {
    // The inner join on `profile` produces no row for a claimed Handle whose
    // owner has never edited anything. That absence is the signal.
    expect(profileFromRows([])).toBeUndefined();
  });

  it("carries the Profile's own columns through", () => {
    const found = profileFromRows([withLink("a", "first", 0)]);

    expect(found?.displayName).toBe("A Name");
    expect(found?.bio).toBe("A bio");
    expect(found?.updatedAt).toBe(UPDATED_AT);
  });

  it("keeps the query's order rather than re-sorting", () => {
    // The adapter orders by `position` in SQL. If this function sorted too, a
    // dropped `ORDER BY` would be invisible to the integration test that exists
    // to catch one — so the rows are handed over deliberately out of order and
    // must come back out of order.
    const found = profileFromRows([
      withLink("c", "third", 2),
      withLink("a", "first", 0),
      withLink("b", "second", 1),
    ]);

    expect(found?.links.map((one) => one.title)).toEqual([
      "third",
      "first",
      "second",
    ]);
  });

  it("reads a Profile with no Links as an empty list, not as absent", () => {
    // Drizzle's first way of reporting an unmatched left join: the nested group
    // is `null`.
    const found = profileFromRows([{ ...base, link: null }]);

    expect(found).toBeDefined();
    expect(found?.links).toEqual([]);
  });

  it("reads an all-null Link group as no Link at all", () => {
    // Drizzle's other way: the group is present with every field `null`. Which
    // of the two a custom nested selection produces is a property of the
    // library's row mapper that only a real query reveals, and this project has
    // no local Postgres — so both are handled, and both are pinned here.
    const found = profileFromRows([
      { ...base, link: { id: null, title: null, url: null, position: null } },
    ]);

    expect(found).toBeDefined();
    expect(found?.links).toEqual([]);
  });

  it("keeps a Link whose position is zero", () => {
    // `0` is falsy, so a truthiness guard on `position` would silently drop the
    // owner's first Link — every list's first row.
    const found = profileFromRows([withLink("a", "first", 0)]);

    expect(found?.links).toEqual([
      {
        id: "a",
        title: "first",
        url: "https://example.com/first",
        position: 0,
      },
    ]);
  });

  it("keeps a Link whose title is empty", () => {
    // Same argument at the other end: `""` is falsy and is a value the write
    // path could legitimately produce.
    const found = profileFromRows([withLink("a", "", 0)]);

    expect(found?.links.map((one) => one.title)).toEqual([""]);
  });
});
