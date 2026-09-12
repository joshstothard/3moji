import { createRecordingEmailSender } from "../auth/adapters/recording-email-sender";
import type { AuthFactory } from "../auth/auth-factory";
import { createAuth } from "../auth/create-auth";
import { createDatabase } from "../db/client";
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

const build = (driver: "neon-http" | "node-postgres") => {
  const emailSender = createRecordingEmailSender();
  const handle = createDatabase({ url: URL, driver });
  const auth: AuthFactory = ({ db, emailSender: sender }) =>
    createAuth({
      db,
      emailSender: sender,
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
   * ADR-0006 decision 6 puts production on `neon-http`, which has no
   * interactive transactions. The Claim cannot run there, and this asserts it
   * says so in terms a reader can act on rather than surfacing the driver's
   * bare "No transactions support in neon-http driver" inside a 500.
   */
  it("explains itself when the driver has no interactive transactions", async () => {
    const { store, close } = build("neon-http");

    await expect(
      store.runInTransaction(() =>
        Promise.resolve({ commit: true, value: "unreachable" }),
      ),
    ).rejects.toThrow(/neon-serverless.+new ADR|ADR-0006 decision 6/s);

    await close();
  });

  it("keeps the driver's own error as the cause, so the diagnosis is checkable", async () => {
    const { store, close } = build("neon-http");

    const failure = await store
      .runInTransaction(() =>
        Promise.resolve({ commit: true, value: "unreachable" }),
      )
      .catch((error: unknown) => error);

    expect(messageOf(causeOf(failure))).toContain("No transactions support");

    await close();
  });

  /**
   * The email is the part that cannot be taken back, so a transaction that
   * never even opened must not have sent one.
   */
  it("sends nothing when the transaction could not be opened", async () => {
    const { store, emailSender, close } = build("neon-http");

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
    const { store, close } = build("node-postgres");

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
    const handle = createDatabase({ url: URL, driver: "node-postgres" });
    const auth = createAuth({
      db: handle.db,
      emailSender: createRecordingEmailSender(),
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
