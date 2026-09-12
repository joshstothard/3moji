import { getTableName } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";

import { handle } from "./handle";
import { user } from "./schema";

const config = getTableConfig(handle);

function column(name: string) {
  const found = config.columns.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(
      `the handle table has no "${name}" column. It has: ${config.columns.map((candidate) => candidate.name).join(", ")}.`,
    );
  }
  return found;
}

describe("the handle table", () => {
  it("is called handle", () => {
    expect(getTableName(handle)).toBe("handle");
  });

  /**
   * The guarantee ADR-0004 decision 1 rests on. A `UNIQUE` index is byte
   * equality *under a collation*, so the collation has to be pinned on the
   * column itself — the database's default is not ours to choose on Neon.
   */
  it("stores the canonical key under a deterministic collation", () => {
    expect(column("key").getSQLType()).toBe('text collate "C"');
  });

  it("makes the canonical key the primary key, so uniqueness cannot be dropped", () => {
    expect(column("key").primary).toBe(true);
  });

  it("constrains the key to exactly three code points", () => {
    expect(config.checks.map((check) => check.name)).toContain(
      "handle_key_three_codepoints",
    );
  });

  /**
   * ADR-0004 decision 7's database layer for the Reserved Handle list: the nine
   * emoji of [#18](https://github.com/joshstothard/3moji/issues/18) cannot
   * reach a row even if the domain guard is bypassed.
   *
   * The constraint is **generated from `BLOCKED_EMOJI`**, so the assertion is
   * that every one of the nine appears in the expression it produced. A
   * hand-written CHECK could drift from the data; this cannot.
   */
  it("refuses a key holding any blocked emoji", () => {
    const blockedCheck = config.checks.find(
      (check) => check.name === "handle_key_no_blocked_emoji",
    );
    if (blockedCheck === undefined) {
      throw new Error(
        `the handle table has no blocked-emoji CHECK. It has: ${config.checks.map((check) => check.name).join(", ")}.`,
      );
    }

    // `chr(<decimal code point>)` rather than a literal emoji: a variation
    // selector is invisible in SQL source, and `chr` is immutable so a CHECK
    // may call it. The decimals are the nine of #18.
    const expression = new PgDialect().sqlToQuery(blockedCheck.value).sql;
    for (const decimal of [
      128405, 128299, 128163, 128298, 129683, 128137, 128138, 128684, 129656,
    ]) {
      expect(expression).toContain(`chr(${String(decimal)})`);
    }
  });

  /**
   * The domain Account is the login, which is Better Auth's `user` row. Better
   * Auth's own `account` table is one row per credential provider, so an FK
   * there would drop a Handle when a provider row went.
   */
  it("owns its Handle from the user table, cascading on delete", () => {
    const [foreignKey] = config.foreignKeys;
    if (foreignKey === undefined) {
      throw new Error("the handle table declares no foreign key");
    }
    const reference = foreignKey.reference();

    expect(getTableName(reference.foreignTable)).toBe(getTableName(user));
    expect(reference.foreignColumns.map((each) => each.name)).toEqual(["id"]);
    expect(foreignKey.onDelete).toBe("cascade");
  });

  it("allows an Account at most one Handle", () => {
    expect(column("user_id").isUnique).toBe(true);
  });

  it("requires the owner, the hold expiry and the creation time", () => {
    for (const name of ["key", "user_id", "held_until", "created_at"]) {
      expect(column(name).notNull).toBe(true);
    }
  });

  /**
   * A NULL `claimed_at` is what "still held" means, so the lazy expiry
   * predicate of ADR-0004 decision 3 is `claimed_at IS NULL AND held_until <=
   * now`. A NOT NULL default would erase the distinction.
   */
  it("leaves claimed_at nullable, because NULL is what still-held means", () => {
    expect(column("claimed_at").notNull).toBe(false);
  });

  /**
   * The Clock port exists so the 24-hour hold is testable. A
   * `now() + interval '24 hours'` default would put the rule in the database
   * where no test can move it.
   */
  it("gives the hold expiry no database default", () => {
    expect(column("held_until").hasDefault).toBe(false);
  });

  /** ADR-0004 decision 6: no Handle change in the MVP, so the row never moves. */
  it("carries no updated_at, because the row does not change", () => {
    expect(config.columns.map((each) => each.name)).not.toContain("updated_at");
  });
});
