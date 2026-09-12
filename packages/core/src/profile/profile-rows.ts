import type { Profile, ProfileLink } from "../ports/profile-repository";

/**
 * The Link columns of a left-joined row, **declared nullable on every field**.
 *
 * Drizzle has two ways of reporting an unmatched left join — the nested group
 * as `null`, or the group present with every field `null` — and which one a
 * custom nested selection produces is a property of the library's row mapper
 * that only a real query reveals. This project cannot run Postgres outside CI,
 * so rather than commit to the shape it guessed at, {@link profileFromRows}
 * handles both, and `profile-rows.test.ts` pins both.
 *
 * Declaring the fields nullable here is also what keeps the guards honest to
 * the linter: they are necessary against *this* type whichever way Drizzle
 * types its own.
 */
export interface JoinedLink {
  readonly id: string | null;
  readonly title: string | null;
  readonly url: string | null;
  readonly position: number | null;
}

/** One row of the `handle → profile → link` join. */
export interface JoinedProfileRow {
  readonly displayName: string | null;
  readonly bio: string | null;
  readonly updatedAt: Date;
  /** `null`, or all-null, when the Profile has no Links. */
  readonly link: JoinedLink | null;
}

/**
 * Fold the join's rows into a {@link Profile}.
 *
 * **The interpretation lives here, not in the adapter** — the same split
 * `createDrizzleHandleRepository` makes by handing its row to `ownershipOf`.
 * A mapping only provable against Postgres is a mapping nobody exercises on
 * every run, and this one has two edge shapes (above) plus two falsy-value
 * traps (`position: 0` and `title: ""`) that a truthiness guard would eat
 * silently.
 *
 * An empty array means the inner join on `profile` matched nothing — the
 * "claimed but unedited" signal, carried by absence rather than by a Profile
 * of nulls.
 */
export function profileFromRows(
  rows: readonly JoinedProfileRow[],
): Profile | undefined {
  const first = rows[0];
  if (first === undefined) return undefined;

  return {
    displayName: first.displayName,
    bio: first.bio,
    updatedAt: first.updatedAt,
    links: linksOf(rows),
  };
}

/**
 * The Link half of the join, with the Profile-without-Links row dropped.
 *
 * A `flatMap` returning `[]` for the empty case rather than a `filter`: it
 * narrows by control flow, where a `filter` would leave the caller needing a
 * type predicate or a cast — and this package forbids both the non-null
 * assertion and the assertion style that would replace it.
 *
 * **Order is the query's, untouched.** Re-sorting here would hide a dropped
 * `ORDER BY position` from the integration test that exists to catch one.
 */
function linksOf(rows: readonly JoinedProfileRow[]): readonly ProfileLink[] {
  return rows.flatMap((row) => {
    const joined = row.link;
    if (joined === null) return [];
    const { id, title, url, position } = joined;
    // Explicit `=== null`, never truthiness: `position` is `0` for every
    // list's first Link and `title` may legitimately be `""`.
    if (id === null || title === null || url === null || position === null) {
      return [];
    }
    return [{ id, title, url, position }];
  });
}
