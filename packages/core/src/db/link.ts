import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { profile } from "./profile";

/**
 * How many Links one Profile may have, from
 * [`data-model.md` § Profile](../../../../docs/architecture/data-model.md).
 *
 * Exported so the write path (#106) and the `CHECK` below are one number in
 * one place, the way `HANDLE_KEY_LENGTH` is.
 */
export const LINK_LIMIT = 10;

/**
 * One link on a Profile: a title, a URL, and the place it sits in the list.
 *
 * **The foreign key is to `profile`, not to `user`.** A Link without a Profile
 * is not a state the product has — `data-model.md` puts Links inside the
 * Profile — and a reference to `profile.user_id` is what makes that
 * unrepresentable rather than merely unwritten. The cascade still reaches the
 * Account, one hop further along: deleting a `user` row deletes its `profile`
 * row, which deletes these. That chain is what
 * `profile.integration.test.ts` asserts, because a two-hop cascade is exactly
 * the kind that is easy to believe in and easy to get wrong.
 *
 * **Order is a column, and it is the only order a read may use.** Neither
 * insertion order nor the primary key is stable under reordering — and
 * reordering is the whole point of "Links are shown in an order the owner
 * sets". Postgres makes no promise about row order without an `ORDER BY`, so a
 * read that omitted one would pass every test on a small table and scramble on
 * a large one.
 */
export const link = pgTable(
  "link",
  {
    /**
     * The row's own identity, supplied by the writer — not the position, and
     * not `(user_id, position)`.
     *
     * A Link's position changes when the owner reorders the list; a primary key
     * that moved with it could not be referenced, and an update that swapped
     * two positions would collide with itself. `verification_dispatch` and
     * `released_handle` carry a supplied `text` id for their own reasons, and
     * this is a third.
     */
    id: text("id").primaryKey(),
    /**
     * The Profile this Link belongs to, cascading from it.
     *
     * The column is named for the Account because that is what
     * `profile.user_id` is; it is a Profile reference in every other sense.
     */
    userId: text("user_id")
      .notNull()
      .references(() => profile.userId, { onDelete: "cascade" }),
    /** The link's visible text, at most 40 characters (enforced in #106). */
    title: text("title").notNull(),
    /**
     * Where the link goes. `http` or `https` only — a rule enforced on the
     * write path (#106) rather than by a regex `CHECK` here, because scheme
     * validation is a domain judgement with error messages attached and a
     * migration is a bad place to keep one.
     */
    url: text("url").notNull(),
    /**
     * Where this Link sits in the owner's list: `0` first, ascending, with no
     * gaps required. **This is what a read orders by.**
     *
     * Not a float and not a sparse integer. A "leave gaps so reordering is
     * cheap" scheme is an optimisation for a list of at most ten rows that are
     * rewritten as one transaction anyway — the over-engineering
     * `docs/development/engineering-standards.md` § Simplicity names.
     */
    position: integer("position").notNull(),
    /**
     * When the row appeared. An audit fact, so `defaultNow()` — the same line
     * `profile.created_at` draws. A Link has no `updated_at`: `profile
     * .updated_at` moves when anything on the Profile changes, and two
     * timestamps for one edit would be two chances to disagree.
     */
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    /**
     * Two Links in one Profile cannot share a position, so "the order the
     * owner sets" is a total order rather than a preference the database may
     * break ties in however it likes. It is also the index the read uses: a
     * lookup by `user_id` returning rows already in `position` order.
     */
    unique("link_user_position").on(table.userId, table.position),
    /**
     * **This is where "at most ten Links" is enforced**, and it is why the
     * limit is structural rather than a count the write path has to remember
     * to take. Ten distinct positions in `0…9`, and no two Links may share one
     * (above), leaves no room for an eleventh row — with no trigger, no
     * `COUNT(*)` in a transaction, and no race between two concurrent writes.
     *
     * **Widening the limit is safe; narrowing it is not.** `ALTER TABLE …
     * ADD CONSTRAINT … CHECK` validates the rows already there, so raising
     * {@link LINK_LIMIT} regenerates cleanly and lowering it would fail the
     * migration against anyone already at the old limit — the same
     * retroactivity trap `handle_key_no_blocked_emoji` documents.
     */
    check(
      "link_position_within_limit",
      sql`${table.position} >= 0 and ${table.position} < ${sql.raw(String(LINK_LIMIT))}`,
    ),
  ],
);
