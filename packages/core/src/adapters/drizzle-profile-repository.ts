import { asc, eq } from "drizzle-orm";

import type { DatabaseOrTransaction } from "../db/client";
import { handle } from "../db/handle";
import type { HandleKey } from "../db/handle-key";
import { link } from "../db/link";
import { profile } from "../db/profile";
import { profileFromRows } from "../profile/profile-rows";
import type { Profile, ProfileRepository } from "../ports/profile-repository";

/**
 * {@link ProfileRepository} over `handle`, `profile` and `link`.
 *
 * It does two things and nothing else — one join, and {@link profileFromRows}
 * to fold its rows. **The interpretation lives in the domain, not here**, for
 * the reason `createDrizzleHandleRepository` gives about `ownershipOf`: a
 * mapping only provable against Postgres is a mapping nobody exercises on every
 * run, and this project has no local database.
 *
 * **One query, not two.** The public Handle page is the most-read thing this
 * product has, and a Profile has at most ten Links, so a left join returning at
 * most eleven narrow rows beats a second round trip. It is an index seek all
 * the way down: `handle.key` is the primary key under the deterministic `C`
 * collation, `handle.user_id` is `UNIQUE`, `profile.user_id` is the primary
 * key, and `link_user_position` covers the Link lookup in the order it is
 * wanted.
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

      return profileFromRows(rows);
    },
  };
}
