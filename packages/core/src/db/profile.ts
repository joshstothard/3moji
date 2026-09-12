import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./schema";

/**
 * The public page a claimed Handle resolves to: a display name and a bio,
 * owned by exactly one Account.
 *
 * Shape is [`data-model.md` § Profile](../../../../docs/architecture/data-model.md);
 * the ownership rules it inherits are
 * [ADR-0004](../../../../docs/adr/0004-the-handle-model.md).
 *
 * **Keyed on the Account, not on the Handle, and `user_id` is the primary
 * key.** Three things follow from that one choice, and they are the reason for
 * it:
 *
 * - **Release stays account deletion.** ADR-0004 decision 5 says "Releasing
 *   takes the Profile and its Links with it". Deleting the `user` row is
 *   already what takes the Handle, the sessions and the credential rows
 *   (`handle.user_id` cascades), so cascading from the same row costs one
 *   `ON DELETE CASCADE` and reuses a path that is already exercised by
 *   `release.integration.test.ts`. Keying on `handle.key` would work too —
 *   `handle` cascades from `user` in turn — but it would put the Profile one
 *   hop further from the row that is actually deleted, for nothing.
 * - **One Profile per Account falls out of the primary key**, rather than
 *   needing a separate `UNIQUE`. ADR-0004 decision 4 makes Account and Handle
 *   one-to-one, so "one Profile per Account" and "one Profile per Handle" are
 *   the same statement; this is the cheaper half to enforce.
 * - **The read is a single-row join.** `handle.user_id` is `UNIQUE` and this
 *   is a primary key, so `handle → profile` on `user_id` can return at most
 *   one row. That is what lets
 *   `src/adapters/drizzle-profile-repository.ts` answer a `HandleKey` in one
 *   query without a `DISTINCT` or a `LIMIT` doing load-bearing work.
 *
 * **The row's existence is the signal.** A claimed Handle whose owner has
 * never edited anything has no row here at all — not a row of empty strings —
 * which is what makes "claimed but unedited" a state a caller can see rather
 * than guess at. That distinction is why both content columns are nullable:
 * `NULL` is "never set", and only a write path (#106) can produce an empty
 * string.
 *
 * **No length `CHECK`s here, unlike `handle`.** The 30- and 160-character
 * limits in `data-model.md` are enforced in `packages/core` on the write path
 * (#106). `handle`'s constraints exist because ADR-0004 decision 7 asks for a
 * three-layer defence of the canonical key specifically; nothing gives these
 * limits that status, and a `CHECK` on a number that may move is a
 * hand-written migration waiting to happen.
 */
export const profile = pgTable("profile", {
  /**
   * The owning Account, and the row's identity.
   *
   * **`user`, not `account`** — the same reason `handle.user_id` gives. Better
   * Auth's `account` table is one row per credential provider, so a reference
   * there would delete somebody's Profile when a provider row was removed.
   *
   * `ON DELETE CASCADE`, because Release is account deletion (ADR-0004
   * decision 5).
   */
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /**
   * The name shown on the page, at most 30 characters. `NULL` until the owner
   * sets one; a Profile row can exist with only Links.
   *
   * It is also what disambiguates an alias listing once the word alias ships
   * ([ADR-0008](../../../../docs/adr/0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md)),
   * which is why it is a column here rather than a field on the Account.
   */
  displayName: text("display_name"),
  /** The page's prose, at most 160 characters. `NULL` until the owner sets one. */
  bio: text("bio"),
  /**
   * When the row appeared. An audit fact rather than a rule — nothing branches
   * on it — so `defaultNow()` is right here for the same reason it is right on
   * `handle.created_at` and wrong on `handle.held_until`.
   */
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /**
   * When the Profile last changed, supplied by the caller from the injected
   * `Clock` and **never** `defaultNow()`.
   *
   * The split from `created_at` above is deliberate and follows the line
   * `handle.ts` draws: an audit fact may be defaulted in SQL, a value the
   * domain reasons about may not. This is the latter — it is what a "last
   * edited" line, a cache revalidation, or a staleness rule would rest on, and
   * a `now()` default would put it where no test can move time.
   */
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
