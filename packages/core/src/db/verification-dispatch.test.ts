import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

import { user } from "./schema";
import { verificationDispatch } from "./verification-dispatch";

const config = getTableConfig(verificationDispatch);

function column(name: string) {
  const found = config.columns.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(
      `the verification_dispatch table has no "${name}" column. It has: ${config.columns.map((candidate) => candidate.name).join(", ")}.`,
    );
  }
  return found;
}

describe("the verification_dispatch table", () => {
  it("is called verification_dispatch", () => {
    expect(getTableName(verificationDispatch)).toBe("verification_dispatch");
  });

  it("keeps a fingerprint of the link, never the link", () => {
    // The verification token is a bearer credential good for an hour. A row
    // holding one would let whoever read it verify somebody else's address.
    expect(column("token_hash").getSQLType()).toBe("text");
    expect(config.columns.map((candidate) => candidate.name)).not.toContain(
      "token",
    );
  });

  /**
   * Stated explicitly because it is the opposite of the obvious choice.
   *
   * Better Auth's JWT carries `iat` at one-second resolution and no nonce, so
   * two links signed for the same address inside one second are byte-identical.
   * A unique index would turn any future path that sent twice quickly into a
   * constraint violation on a bookkeeping row, in exchange for nothing —
   * duplicate rows here are indistinguishable from each other anyway, and both
   * reads take the newest.
   */
  it("does not make the fingerprint unique", () => {
    expect(column("token_hash").isUnique).toBe(false);
  });

  it("indexes both lookups it performs, so neither is a scan", () => {
    // Fingerprint to Account, for a followed link; and Account to its recent
    // links, for the rate limit and the freshness check.
    expect(config.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        "verification_dispatch_token_hash_idx",
        "verification_dispatch_user_sent_at_idx",
      ]),
    );
  });

  it("gives sent_at no SQL default, so the window is a domain rule", () => {
    // `defaultNow()` would put the rate-limit window where no test can move
    // time — the same argument `handle.held_until` makes.
    expect(column("sent_at").hasDefault).toBe(false);
    expect(column("sent_at").notNull).toBe(true);
  });

  /**
   * The one constraint that matters beyond performance. Freeing an expired
   * hold is deleting the unverified Account (ADR-0004 decision 5), and Release
   * is account deletion — so this table must never be the reason a deleted
   * Account leaves a trace behind.
   */
  it("cascades from the Account, so a deleted Account leaves no trace here", () => {
    const [reference] = config.foreignKeys.map((key) => key.reference());

    expect(config.foreignKeys).toHaveLength(1);
    expect(reference?.foreignTable).toBe(user);
    expect(
      reference?.foreignColumns.map((candidate) => candidate.name),
    ).toEqual(["id"]);
    expect(config.foreignKeys[0]?.onDelete).toBe("cascade");
  });
});
