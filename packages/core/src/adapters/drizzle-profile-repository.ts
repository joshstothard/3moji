import { asc, eq } from "drizzle-orm";

import type { DatabaseOrTransaction } from "../db/client";
import { handle } from "../db/handle";
import type { HandleKey } from "../db/handle-key";
import { link } from "../db/link";
import { profile } from "../db/profile";
import type {
  Profile,
  ProfileLink,
  ProfileRepository,
} from "../ports/profile-repository";

/**
 * {@link ProfileRepository} over `handle`, `profile` and `link`.
 *
 * **One query, not two.** The public Handle page is the most-read thing this
 * product has, and a Profile has at most ten Links, so a left join returning at
 * most eleven narrow rows is cheaper than a second round trip. The join is an
 * index seek all the way down: `handle.key` is the primary key under the
 * deterministic `C` collation, `handle.user_id` is `UNIQUE`, `profile.user_id`
 * is the primary key, and `link_user_position` covers the Link lookup in the
 * order it is wanted.
 *
 * **`ORDER BY position` is the behaviour, not a tidying.** Postgres promises
 * nothing about row order without one, and both of the orders a reader might
 * assume instead — insertion order, and the primary key — are wrong by
 * construction, because reordering a list changes neither.
 *
 * It takes a client **or a transaction**, like the other read adapters, so a
 * future write path can read its own uncommitted list back through this same
 * code rather than a second copy that could order it differently.
 */
export function createDrizzleProfileRepository(
  db: DatabaseOrTransaction,
): ProfileRepository {
  return {
    async profileOf(key: HandleKey): Promise<Profile | undefined> {
      const rows = await db
        .select({
          displayName: profile.displayName,
          bio: profile.bio,
          updatedAt: profile.updatedAt,
          link: {
            id: link.id,
            title: link.title,
            url: link.url,
            position: link.position,
          },
        })
        .from(handle)
        // `innerJoin`, so a claimed Handle whose owner has never edited
        // anything yields no row at all and the caller gets `undefined` — the
        // "claimed but unedited" signal, carried by the row's absence rather
        // than by a Profile of nulls.
        .innerJoin(profile, eq(profile.userId, handle.userId))
        // `leftJoin`, so a Profile with no Links is still a Profile.
        .leftJoin(link, eq(link.userId, profile.userId))
        .where(eq(handle.key, key))
        .orderBy(asc(link.position));

      const first = rows[0];
      if (first === undefined) return undefined;

      return {
        displayName: first.displayName,
        bio: first.bio,
        updatedAt: first.updatedAt,
        links: linksOf(rows),
      };
    },
  };
}

/**
 * The Link columns of a left-joined row, **declared nullable on every field**.
 *
 * Drizzle has two ways of reporting an unmatched left join — the nested group
 * as `null`, or the group present with every field `null` — and which one a
 * custom nested selection produces is a property of the library's row mapper
 * that only a real query reveals. This project cannot run Postgres outside CI,
 * so rather than commit to the shape it guessed at, the mapping below handles
 * both. Declaring the fields nullable here is also what keeps the guards honest
 * to the linter: they are necessary against *this* type whichever way Drizzle
 * types its own.
 */
interface JoinedLink {
  readonly id: string | null;
  readonly title: string | null;
  readonly url: string | null;
  readonly position: number | null;
}

/** The shape the join hands back: one row per Link, or one row with none. */
interface JoinedRow {
  readonly link: JoinedLink | null;
}

/**
 * The Link half of a left join, with the Profile-without-Links row dropped.
 *
 * A `flatMap` returning `[]` for the empty case rather than a `filter`: it
 * narrows by control flow, where a `filter` would leave the caller needing a
 * type predicate or a cast — and this package forbids both the non-null
 * assertion and the assertion style that would replace it.
 *
 * Order is the query's, untouched. Re-sorting here would hide a dropped
 * `ORDER BY` from the integration test that exists to catch one.
 */
function linksOf(rows: readonly JoinedRow[]): readonly ProfileLink[] {
  return rows.flatMap((row) => {
    const joined = row.link;
    if (joined === null) return [];
    const { id, title, url, position } = joined;
    if (id === null || title === null || url === null || position === null) {
      return [];
    }
    return [{ id, title, url, position }];
  });
}
