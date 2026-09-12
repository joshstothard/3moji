import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { handleKeyColumn } from "./handle";

/**
 * One Release: the canonical key that went back into the pool, and when.
 *
 * **Adding a user reference here would stop account deletion being deletion.**
 * That sentence is the table's whole constraint and the reason it is written on
 * the table rather than only in
 * [ADR-0009](../../../../docs/adr/0009-release-leaves-a-tombstone-and-the-cooldown-is-dropped-for-the-mvp.md)
 * decision 3: Release *is* account deletion (ADR-0004 decision 5), and a row
 * pairing a Handle with its former owner would make "Releasing takes the
 * Profile and its Links with it" true in letter and false in substance. No
 * `user_id`, no email, no Profile field, no foreign key to any Account — and
 * none to `handle` either, since that row cascades away with the Account and a
 * reference would dangle the instant it was written. The canonical key was a
 * public URL already, so on its own it identifies nobody.
 *
 * **Why the table exists at all, given nothing reads it.** The cooldown is
 * dropped for the MVP (decision 1) — a released Handle is claimable
 * immediately, by anyone, including its previous owner — so these rows answer
 * no question today. They exist because **time cannot be backfilled**: a
 * cooldown switched on in six months with no history behind it starts blind
 * and cannot say when anything was released. ADR-0009 confronts the smell
 * directly; if the argument is wrong, that is the decision to revisit first.
 *
 * **Nothing reads it, and that is what makes "no cooldown" structural.** The
 * claim path does not consult this table (decision 5), so there is no branch to
 * get wrong and no stale row can block a legitimate claim. Turning a cooldown
 * on is a new ADR plus a read in the claim gate.
 *
 * **Evidence, not an invariant.** The write lives in the release use case
 * rather than a database trigger, because `drizzle-kit generate` owns this
 * schema (decision 4) — the same trade already taken for the blocked-emoji
 * `CHECK`. So a deletion that bypasses the use case, such as a direct `DELETE`
 * on a `user` row, leaves no tombstone. Nothing is load-bearing on it while the
 * cooldown is off.
 *
 * Rows are **never swept** in the MVP (decision 6): a row is a key and a time,
 * there is no retention rule to get right yet, and sweeping would destroy the
 * history the table exists to keep.
 */
export const releasedHandle = pgTable("released_handle", {
  /**
   * The row's own identity, supplied by the adapter — **not the key**.
   *
   * The cooldown being dropped means a Handle can be released, reclaimed and
   * released again, which is a legitimate history of two rows for one key. A
   * primary key on `key` would raise a unique violation inside the second
   * Release's transaction and make a legitimate account deletion impossible.
   * `verification_dispatch` carries a supplied `text` id for the same reason:
   * the row is an event, and events repeat.
   */
  id: text("id").primaryKey(),
  /**
   * The canonical key that was released, in the same column type `handle.key`
   * uses — imported rather than redeclared, so the deterministic `"C"`
   * collation is one decision in one place. A future cooldown compares this
   * against `handle.key`, and two collations would make that comparison
   * locale-dependent.
   *
   * Deliberately **not unique and not indexed**. Nothing reads the table, so an
   * index would be built for a hypothetical future query — the
   * over-engineering `docs/development/engineering-standards.md` § Simplicity
   * names. The read a cooldown needs is a new ADR's problem, and its migration
   * can add the index it actually wants.
   */
  key: handleKeyColumn("key").notNull(),
  /**
   * When the Handle returned to the pool, supplied from the injected `Clock`
   * and never `defaultNow()`. This is the timestamp a cooldown would be dated
   * from, which makes it a domain value rather than an audit fact — the same
   * argument `handle.held_until` makes, and the opposite of
   * `handle.created_at`.
   */
  releasedAt: timestamp("released_at", { withTimezone: true }).notNull(),
});
