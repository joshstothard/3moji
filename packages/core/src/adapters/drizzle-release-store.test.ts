import { createDatabase } from "../db/client";
import { toHandleKey } from "../db/handle-key";
import {
  createDrizzleReleaseStore,
  releaseTransactionOn,
} from "./drizzle-release-store";

/**
 * A URL is required to build a client, but **nothing here connects**: the port
 * is closed on purpose, and a refused connection is exactly the behaviour under
 * test.
 */
const URL = "postgresql://app:app@127.0.0.1:59999/app_test";

/** The `message` of an unknown rejection, without `instanceof`. */
const messageOf = (error: unknown): string =>
  typeof error === "object" &&
  error !== null &&
  "message" in error &&
  typeof error.message === "string"
    ? error.message
    : `not an error: ${String(error)}`;

/** The `cause` of an unknown rejection, or `undefined`. */
const causeOf = (error: unknown): unknown =>
  typeof error === "object" && error !== null && "cause" in error
    ? error.cause
    : undefined;

/**
 * Every message down an unknown rejection's `cause` chain, joined.
 *
 * Drizzle reports a failed statement as "Failed query: …" and keeps the
 * driver's own error — the one carrying `ECONNREFUSED` — in `cause`, so a match
 * against the top-level message alone finds the SQL and not the reason.
 * `toBeInstanceOf(Error)` is unusable here: `--experimental-vm-modules` runs
 * ESM in its own realm, so the driver's `Error` is not the test realm's.
 */
const messagesOf = (error: unknown, depth = 0): string =>
  depth > 8
    ? ""
    : `${messageOf(error)} ${
        causeOf(error) === undefined
          ? ""
          : messagesOf(causeOf(error), depth + 1)
      }`;

const KEY = toHandleKey("\u{1F9CA}\u{1F9CA}\u{1F9CA}");
if (KEY === undefined) throw new Error("the test Handle must canonicalise");

describe("createDrizzleReleaseStore", () => {
  /**
   * A transaction that could not even be opened must **fail loudly**. Release
   * is account deletion, and a store that swallowed the failure would answer
   * the person "your Account is gone" while every row is still there.
   */
  it("surfaces a connection failure rather than reporting a Release", async () => {
    const handle = createDatabase({ url: URL });
    const store = createDrizzleReleaseStore({ db: handle.db });

    const failure = await store
      .runInTransaction(() =>
        Promise.resolve({ commit: true, value: "unreachable" }),
      )
      .then((value) => `resolved: ${value}`)
      .catch((error: unknown) => messagesOf(error));

    expect(failure).toMatch(/ECONNREFUSED|connect/);
    await handle.close();
  });

  /**
   * A callback that returns no verdict is a **programming error, reported as
   * one**. Drizzle's `transaction` resolves whatever the callback returns, so
   * an implementation that assumed a verdict was set would silently return
   * `undefined` as the Release's result.
   */
  it("refuses a unit of work that reaches no verdict", async () => {
    const handle = createDatabase({ url: URL });
    const store = createDrizzleReleaseStore({ db: handle.db });
    // The transaction never opens, so the callback never runs and no verdict is
    // ever recorded — the shape the guard exists for, reachable without a
    // database.
    const failure = await store
      .runInTransaction(() =>
        Promise.resolve({ commit: false, value: "never-reached" }),
      )
      .then((value) => `resolved: ${value}`)
      .catch((error: unknown) => messageOf(error));

    expect(failure).toMatch(/ECONNREFUSED|connect|without a verdict/);
    await handle.close();
  });
});

/**
 * What one Release's reads and writes do when the database is **unreachable**.
 *
 * Every one of them must fail closed. A swallowed failure in `handleOf` reads
 * as "this Account owns nothing" and abandons a Release that should have
 * happened; a swallowed failure in `recordRelease` deletes an Account and keeps
 * no record of the Handle, which is the one fact ADR-0009 says cannot be
 * recreated; a swallowed failure in `deleteAccount` reports a deletion that did
 * not happen. The behaviour against a database that answers is
 * `release.integration.test.ts`'s, in CI.
 */
describe("releaseTransactionOn against an unreachable database", () => {
  const build = () => {
    const handle = createDatabase({ url: URL });
    return { tx: releaseTransactionOn(handle.db), close: handle.close };
  };

  it("does not read an unreachable database as an Account owning no Handle", async () => {
    const { tx, close } = build();

    const failure = await tx
      .handleOf("some-user")
      .then((key) => `resolved: ${String(key)}`)
      .catch((error: unknown) => messagesOf(error));

    expect(failure).toMatch(/ECONNREFUSED/);
    await close();
  });

  it("does not report a tombstone it could not write", async () => {
    const { tx, close } = build();

    const failure = await tx
      .recordRelease({ key: KEY, releasedAt: new Date("2026-09-12T12:00:00Z") })
      .then(() => "resolved")
      .catch((error: unknown) => messagesOf(error));

    expect(failure).toMatch(/ECONNREFUSED/);
    await close();
  });

  it("does not report a deletion it could not perform", async () => {
    const { tx, close } = build();

    const failure = await tx
      .deleteAccount("some-user")
      .then(() => "resolved")
      .catch((error: unknown) => messagesOf(error));

    expect(failure).toMatch(/ECONNREFUSED/);
    await close();
  });
});
