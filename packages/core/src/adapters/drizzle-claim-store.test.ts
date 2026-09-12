import { createRecordingEmailSender } from "../auth/adapters/recording-email-sender";
import type { AuthFactory } from "../auth/auth-factory";
import { createAuth } from "../auth/create-auth";
import { createDatabase } from "../db/client";
import { createInMemoryVerificationDispatchStore } from "./in-memory-verification-dispatch-store";
import { toHandleKey } from "../db/handle-key";
import {
  claimTransactionOn,
  createDrizzleClaimStore,
} from "./drizzle-claim-store";

/**
 * A URL is required to build a client, but **nothing here connects**: the
 * neon-http driver refuses `transaction` before it would open a socket, which
 * is exactly the behaviour under test.
 */
const URL = "postgresql://app:app@127.0.0.1:59999/app_test";

/**
 * The `message` of an unknown rejection, without `instanceof`.
 *
 * `--experimental-vm-modules` runs ESM in its own realm, so an `Error` raised
 * inside the database driver is not the test realm's `Error` and
 * `toBeInstanceOf(Error)` reports "Expected constructor: Error, Received
 * constructor: Error". Reading the property is realm-independent, and the
 * package forbids casting `unknown` into shape, so the narrowing is spelled out.
 */
const messageOf = (error: unknown): string =>
  typeof error === "object" &&
  error !== null &&
  "message" in error &&
  typeof error.message === "string"
    ? error.message
    : `not an error: ${String(error)}`;

/**
 * Every message down an unknown rejection's `cause` chain, joined.
 *
 * Drizzle reports a failed statement as "Failed query: …" and keeps the
 * driver's own error — the one carrying `ECONNREFUSED` — in `cause`, so a match
 * against the top-level message alone finds the SQL and not the reason.
 */
const messagesOf = (error: unknown, depth = 0): string =>
  depth > 8
    ? ""
    : `${messageOf(error)} ${
        causeOf(error) === undefined
          ? ""
          : messagesOf(causeOf(error), depth + 1)
      }`;

/** The `cause` of an unknown rejection, or `undefined`. */
const causeOf = (error: unknown): unknown =>
  typeof error === "object" && error !== null && "cause" in error
    ? error.cause
    : undefined;

const build = () => {
  const emailSender = createRecordingEmailSender();
  const handle = createDatabase({ url: URL });
  const auth: AuthFactory = ({ db, emailSender: sender, dispatches }) =>
    createAuth({
      db,
      emailSender: sender,
      dispatches,
      clock: { now: () => new Date("2026-09-12T12:00:00.000Z") },
      baseUrl: "http://localhost:3000",
      secret: "a".repeat(32),
      from: "3moji <no-reply@mail.3moji.me>",
    });

  return {
    emailSender,
    close: handle.close,
    store: createDrizzleClaimStore({ db: handle.db, auth, emailSender }),
  };
};

describe("createDrizzleClaimStore", () => {
  /**
   * The email is the part that cannot be taken back, so a transaction that
   * never even opened must not have sent one.
   */
  it("sends nothing when the transaction could not be opened", async () => {
    // The transaction fails to open because the database is unreachable —
    // previously this used a driver that could not open one at all. The
    // realistic failure exercises the same branch and outlives the driver.
    const { store, emailSender, close } = build();

    await store
      .runInTransaction(() =>
        Promise.resolve({ commit: true, value: "unreachable" }),
      )
      .catch(() => undefined);

    expect(emailSender.sent).toHaveLength(0);
    await close();
  });

  /**
   * The node-postgres path is proved against a real Postgres in
   * `claim.integration.test.ts`; here the connection is refused on purpose, and
   * what matters is that the refusal is **not** dressed up as the neon-http
   * diagnosis. A translation that matched too eagerly would hide every genuine
   * database failure behind an ADR reference.
   */
  it("passes a genuine connection failure through untranslated", async () => {
    const { store, close } = build();

    const failure = await store
      .runInTransaction(() =>
        Promise.resolve({ commit: true, value: "unreachable" }),
      )
      .catch((error: unknown) => error);

    expect(messageOf(failure)).not.toContain("ADR-0006");
    // A real failure, not a resolved promise dressed up as one.
    expect(messageOf(failure)).toMatch(/ECONNREFUSED|connect/);

    await close();
  });
});

/**
 * What one Claim's reads and writes do when the database is **unreachable**.
 *
 * No Postgres is needed to prove the part that matters here: every one of these
 * must **fail closed**. A swallowed failure in any of them is worse than an
 * error — an unreachable database read as "available" hands out a Handle
 * somebody owns, and a connection drop read as "the key was taken" tells a
 * claimant their Handle is gone when nothing was even attempted. The behaviour
 * against a database that answers is `claim.integration.test.ts`'s, in CI.
 */
describe("claimTransactionOn against an unreachable database", () => {
  const KEY = toHandleKey("\u{1F9CA}\u{1F9CA}\u{1F9CA}");
  if (KEY === undefined) throw new Error("the test Handle must canonicalise");

  const build = () => {
    const handle = createDatabase({ url: URL });
    const auth = createAuth({
      db: handle.db,
      emailSender: createRecordingEmailSender(),
      dispatches: createInMemoryVerificationDispatchStore(),
      clock: { now: () => new Date("2026-09-12T12:00:00.000Z") },
      baseUrl: "http://localhost:3000",
      secret: "a".repeat(32),
      from: "3moji <no-reply@mail.3moji.me>",
    });
    return { tx: claimTransactionOn(handle.db, auth), close: handle.close };
  };

  it("does not report an unreachable Handle as available", async () => {
    const { tx, close } = build();

    const failure = await tx
      .availabilityOf(KEY, new Date("2026-09-12T12:00:00.000Z"))
      .then(() => "resolved")
      .catch((error: unknown) => messagesOf(error));

    expect(failure).toMatch(/ECONNREFUSED/);
    await close();
  });

  it("does not read a failed duplicate-email check as a free address", async () => {
    const { tx, close } = build();

    const failure = await tx
      .createAccount({
        email: "claimant@example.com",
        password: "correct horse battery staple",
        name: "\u{1F9CA}\u{1F9CA}\u{1F9CA}",
      })
      .then(() => "resolved")
      .catch((error: unknown) => messagesOf(error));

    expect(failure).toMatch(/ECONNREFUSED/);
    await close();
  });

  /**
   * The freeing write must not report "nothing to free" when it never managed
   * to look. `freed: false` is the ordinary answer for a Handle with no expired
   * row, so a swallowed failure here would be indistinguishable from the happy
   * path — and the Claim would go on to an insert the primary key then refuses,
   * reporting a race that never happened.
   */
  it("does not read an unreachable database as nothing to free", async () => {
    const { tx, close } = build();

    const failure = await tx
      .freeExpiredHold(KEY, new Date("2026-09-12T12:00:00.000Z"))
      .then((freed) => `resolved: ${JSON.stringify(freed)}`)
      .catch((error: unknown) => messagesOf(error));

    expect(failure).toMatch(/ECONNREFUSED/);
    await close();
  });

  /**
   * `holdHandle` reads a SQLSTATE to decide whether the primary key refused the
   * row, and `23505` is the only code that means that. Anything else has to
   * propagate: a `catch` that returned `key-taken` for every failure would pass
   * every race test in the suite and lie on every outage.
   */
  it("does not read a connection failure as the key being taken", async () => {
    const { tx, close } = build();

    const failure = await tx
      .holdHandle({
        key: KEY,
        userId: "user-1",
        heldUntil: new Date("2026-09-13T12:00:00.000Z"),
      })
      .then((written) => `resolved: ${JSON.stringify(written)}`)
      .catch((error: unknown) => messagesOf(error));

    expect(failure).toMatch(/ECONNREFUSED/);
    await close();
  });
});
