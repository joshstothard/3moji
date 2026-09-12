import { sql, type SQL } from "drizzle-orm";
import {
  check,
  customType,
  pgTable,
  text,
  timestamp,
  type PgColumn,
} from "drizzle-orm/pg-core";

import { BLOCKED_EMOJI } from "../handle/reserved-handles";

import { HANDLE_KEY_LENGTH, type HandleKey } from "./handle-key";
import { user } from "./schema";

/**
 * `text` with a **deterministic collation pinned on the column**, carrying the
 * branded {@link HandleKey} as its TypeScript type.
 *
 * Both halves matter, and both are ADR-0004 decision 1:
 *
 * - **The collation.** A Postgres `UNIQUE` index is byte equality *under a
 *   collation*. The default collation belongs to the database, not to us — this
 *   runs on Neon in production (ADR-0006 decision 6) and on `postgres:16` in
 *   CI, and a non-deterministic ICU collation would make the index decide
 *   equality by locale rules rather than by bytes. `"C"` is the collation that
 *   is deterministic by definition and identical everywhere. Stating it on the
 *   column rather than only on an index means the primary key, every future
 *   index, and every `WHERE key = …` inherit it.
 * - **The brand.** `HandleKey` is obtainable only by canonicalising
 *   (`src/db/handle-key.ts`), so the write path the ADR insists on is the one
 *   the type system permits.
 *
 * A `customType` is how both arrive at once: Drizzle's `text` has no collation
 * option, and an expression index would pin the comparison in one index while
 * leaving the column's own equality on the database's default.
 */
const handleKeyColumn = customType<{ data: HandleKey; driverData: string }>({
  dataType: () => 'text collate "C"',
});

/**
 * The decimal code point of a single-code-point emoji.
 *
 * `codePointAt` returns `number | undefined`, and the package's lint forbids
 * both `any` and the non-null assertion that would paper over it, so the
 * impossible branch is spelled out. It is reached only if a row in
 * {@link BLOCKED_EMOJI} has an empty `emoji`, which a domain test also catches.
 */
function decimalCodePoint(emoji: string): number {
  const codePoint = emoji.codePointAt(0);
  if (codePoint === undefined) {
    throw new Error(
      `a blocked-emoji row carries no code point: ${JSON.stringify(emoji)}`,
    );
  }
  return codePoint;
}

/**
 * `key` contains none of the nine blocked emoji, as one SQL expression.
 *
 * **Generated from {@link BLOCKED_EMOJI}, never hand-written**, so the
 * constraint and the versioned data cannot drift: adding a row here is the only
 * way to change what the database refuses, and the generated migration shows
 * the change in the diff.
 *
 * `chr(<decimal>)` rather than an emoji literal. A variation selector is
 * invisible in source and a SQL file holding one is unreviewable — the same
 * argument `canonicalise` makes for writing the presentation selectors as
 * escapes. `chr` is `IMMUTABLE`, which is what lets a `CHECK` call it at all,
 * and `strpos` searches the whole string, which is what "wherever they appear"
 * means.
 */
function withoutBlockedEmoji(key: PgColumn): SQL {
  return sql.join(
    BLOCKED_EMOJI.map(
      (blocked) =>
        sql`strpos(${key}, chr(${sql.raw(String(decimalCodePoint(blocked.emoji)))})) = 0`,
    ),
    sql` and `,
  );
}

/**
 * A claimed or held Handle: an ordered sequence of emoji from the Emoji Set,
 * owned by exactly one Account.
 *
 * **This is the first table we design ourselves** — the four in `schema.ts`
 * are Better Auth's, and the warning there about property keys being
 * load-bearing does not apply here. Nothing addresses these columns by string.
 *
 * Shape is [ADR-0004](../../../../docs/adr/0004-the-handle-model.md), current
 * state is [`data-model.md`](../../../../docs/architecture/data-model.md), and
 * the vocabulary is [`CONTEXT.md`](../../../../CONTEXT.md). There is
 * deliberately no display column: every emoji in the Set renders correctly
 * as-is, so the key is the whole Handle.
 *
 * **Not built here.** This is the table the claim flow will use, not the claim
 * flow. Two rules of ADR-0004 are therefore only half-enforced by these
 * columns, and both are deliberate:
 *
 * - Decision 4's invariant, *every live Account owns exactly one Handle*. The
 *   unique `user_id` gives the *at most one* half. The *at least one* half is
 *   atomicity — account creation and the hold are one act — which lives in the
 *   claim transaction, not in a constraint.
 * - Decision 5's 30-day cooldown before a released Handle returns to the pool.
 *   Release *is* account deletion, and this row cascades away with the
 *   Account, so a released Handle leaves nothing behind to date the cooldown
 *   from. That gap is real and is recorded in `data-model.md`; it wants a
 *   deliberate decision in Phase 3, not a tombstone table invented here with
 *   nothing writing to it.
 */
export const handle = pgTable(
  "handle",
  {
    /**
     * The canonical key: the bare code-point sequence, NFC-normalised with the
     * presentation selectors stripped. The primary key, so the uniqueness the
     * product rests on cannot be dropped without dropping the table.
     */
    key: handleKeyColumn("key").primaryKey(),
    /**
     * The owning Account.
     *
     * **`user`, not `account`.** The domain Account of `CONTEXT.md` — "a login
     * identified by an email address and a password" — is Better Auth's `user`
     * row. Better Auth's `account` table is one row *per credential provider*
     * for a user, so a foreign key there would delete somebody's Handle when a
     * provider row was removed. The column follows `session.user_id` for the
     * same reason.
     *
     * `UNIQUE`, because an Account owns at most one Handle (decision 4), and
     * `ON DELETE CASCADE`, because Release is account deletion (decision 5).
     */
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    /**
     * When the hold dies. Supplied by the caller from the injected `Clock`,
     * never defaulted in SQL: the 24-hour hold of decision 3 is a domain rule,
     * and a `now() + interval '24 hours'` default would put it where no test
     * can move time.
     *
     * Holds expire **lazily** — there is no sweep — so this column is read by
     * whoever next attempts the Handle. With `claimed_at` it gives that reader
     * its predicate: `claimed_at IS NULL AND held_until < now()` is a Handle
     * free to take.
     */
    heldUntil: timestamp("held_until", { withTimezone: true }).notNull(),
    /**
     * When the Claim became final, which is when the Account's email was
     * verified. `NULL` is what "still held" means, so the column is nullable
     * by design rather than by omission.
     */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    /**
     * When the row appeared. An audit fact, not a rule, so `defaultNow()` is
     * right here where it is wrong for `held_until`.
     *
     * There is no `updated_at`: decision 6 rules out changing a Handle in the
     * MVP, so the only mutation this row ever sees is `claimed_at` going from
     * `NULL` to a time.
     */
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    /**
     * Decision 7's third layer, in the place that has the last word. The
     * domain rejects a wrong-length Handle and the claim transaction re-checks
     * it; this catches the specific bug ADR-0004 fears most — a stray U+FE0F
     * surviving canonicalisation to the write — even if both earlier layers
     * are wrong.
     *
     * `char_length` counts **code points**, and every Emoji Set entry is a
     * single code point (ADR-0005 decision 1), so three code points is exactly
     * three emoji. Decision 2 reserves the one- and two-emoji lengths.
     */
    check(
      "handle_key_three_codepoints",
      sql`char_length(${table.key}) = ${sql.raw(String(HANDLE_KEY_LENGTH))}`,
    ),
    /**
     * The Reserved Handle list's database layer, and the same decision 7
     * argument applied to a different rule: the nine blocked emoji of
     * [#18](https://github.com/joshstothard/3moji/issues/18) cannot reach a row
     * even if the domain guard in `src/handle/claimable.ts` is bypassed — by a
     * bug, a script, or a psql session.
     *
     * **Only the nine are here, not the reserved entries.** The nine are a
     * *rule* — "wherever they appear" — which is what a CHECK expresses well,
     * and they are the half that protects people rather than brands. The
     * entries are the half that grows case by case; regenerating a constraint
     * on every addition would buy nothing the domain guard does not already
     * give, and it would put a commercial list in a migration.
     *
     * **A later addition to the nine needs a hand-written migration.**
     * `ALTER TABLE … ADD CONSTRAINT … CHECK` validates existing rows, so
     * adding an emoji here would fail the migration if any Handle already
     * contained it — the exact retroactivity #18 forbids. At launch there are
     * no rows, so this one is safe as generated. A future addition must be
     * `ADD CONSTRAINT … NOT VALID`, which applies to new writes only, leaving
     * an already-claimed Handle to a deliberate takedown. The domain layer is
     * where the future-claims-only rule is tested, because that is where it
     * lives.
     */
    check("handle_key_no_blocked_emoji", withoutBlockedEmoji(table.key)),
  ],
);
