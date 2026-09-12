import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

import { releasedHandle } from "./released-handle";

const config = getTableConfig(releasedHandle);

const columnNames = config.columns.map((column) => column.name).sort();

function column(name: string) {
  const found = config.columns.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(
      `the released_handle table has no "${name}" column. It has: ${columnNames.join(", ")}.`,
    );
  }
  return found;
}

describe("the released_handle table", () => {
  it("is called released_handle", () => {
    expect(getTableName(releasedHandle)).toBe("released_handle");
  });

  /**
   * **ADR-0009 decision 3, asserted as the whole column set rather than as
   * three separate presence checks.**
   *
   * The realistic failure this table has is not a missing column — it is a
   * `user_id` added later for convenience, which would make account deletion
   * stop being deletion. A test that only asserted the three columns exist
   * would stay green through exactly that change; this one goes red.
   */
  it("holds the canonical key and the release timestamp and nothing else", () => {
    expect(columnNames).toEqual(["id", "key", "released_at"]);
  });

  /**
   * The same collation the `handle` table pins, because it is the same column
   * type — `handleKeyColumn`, imported rather than redeclared. A future
   * cooldown reads this key against `handle.key`, and two collations would make
   * that comparison locale-dependent.
   */
  it("stores the key under the same deterministic collation as handle", () => {
    expect(column("key").getSQLType()).toBe('text collate "C"');
  });

  /**
   * **The key is deliberately not the primary key, and that is a correctness
   * decision rather than a style one.** The cooldown is dropped (decision 1),
   * so a Handle may be released, reclaimed and released again — a legitimate
   * history of two rows for one key. A primary key on `key` would raise a
   * unique violation inside the second deletion's transaction and make a
   * legitimate account deletion impossible.
   */
  it("gives each release its own row rather than one row per key", () => {
    expect(column("id").primary).toBe(true);
    expect(column("key").primary).toBe(false);
    expect(config.uniqueConstraints).toHaveLength(0);
  });

  /**
   * No foreign key of any kind. Decision 3 forbids one to `user`, and there is
   * none to `handle` either: the Handle row cascades away with the Account, so
   * a reference would be dangling the instant it was written.
   */
  it("references no other table", () => {
    expect(config.foreignKeys).toHaveLength(0);
  });

  /**
   * Both timestamps on this schema that carry a rule are supplied from the
   * injected `Clock`, never `defaultNow()` — `handle.held_until` makes the same
   * argument. `released_at` is the timestamp a future cooldown would be dated
   * from, so a SQL default would put it where no test can move time.
   */
  it("takes the release timestamp from the caller rather than from SQL", () => {
    expect(column("released_at").hasDefault).toBe(false);
    expect(column("released_at").notNull).toBe(true);
    expect(column("released_at").getSQLType()).toBe("timestamp with time zone");
  });
});
