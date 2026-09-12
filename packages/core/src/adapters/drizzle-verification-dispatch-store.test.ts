import { createDatabase } from "../db/client";
import { createDrizzleVerificationDispatchStore } from "./drizzle-verification-dispatch-store";

/**
 * A URL that resolves but refuses connections, so every query fails at the
 * socket. Nothing here needs a database: what is under test is that these
 * reads **fail loudly** rather than answering.
 *
 * The behaviour against a database that answers is
 * `verification-dispatch.integration.test.ts`'s, in CI.
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
 * Every message down the `cause` chain, joined.
 *
 * Drizzle reports a failed statement as "Failed query: …" and keeps the
 * driver's own error — the one carrying `ECONNREFUSED` — in `cause`.
 */
const messagesOf = (error: unknown, depth = 0): string =>
  depth > 8
    ? ""
    : `${messageOf(error)} ${
        causeOf(error) === undefined
          ? ""
          : messagesOf(causeOf(error), depth + 1)
      }`;

const build = () => {
  const handle = createDatabase({ url: URL });
  return {
    store: createDrizzleVerificationDispatchStore({
      db: handle.db,
      newId: () => "fixed-id",
    }),
    close: handle.close,
  };
};

describe("createDrizzleVerificationDispatchStore against an unreachable database", () => {
  it("fails loudly on record rather than pretending a link was recorded", async () => {
    // A swallowed failure here would leave a live link with no row, which
    // `finaliseClaim` can only read as a link we never issued.
    const { store, close } = build();

    const thrown: unknown = await store
      .record({
        userId: "user-1",
        tokenHash: "abc",
        sentAt: new Date("2026-09-12T12:00:00.000Z"),
      })
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(messagesOf(thrown)).toMatch(/ECONNREFUSED|connect/i);
    await close();
  });

  it("fails loudly on findByTokenHash rather than answering 'no such link'", async () => {
    // "Not found" and "could not look" must not be the same answer: the first
    // sends someone to the generic screen, the second is an outage.
    const { store, close } = build();

    const thrown: unknown = await store
      .findByTokenHash("abc")
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(messagesOf(thrown)).toMatch(/ECONNREFUSED|connect/i);
    await close();
  });

  it("fails loudly on the rate-limit read rather than reporting no sends", async () => {
    // An empty list read as "nothing sent yet" is a rate limit that opens up
    // whenever the database is unreachable.
    const { store, close } = build();

    const thrown: unknown = await store
      .since("user-1", new Date("2026-09-12T11:00:00.000Z"))
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(messagesOf(thrown)).toMatch(/ECONNREFUSED|connect/i);
    await close();
  });

  it("fails loudly on newestFor rather than reporting no newest link", async () => {
    // `newestFor` returning undefined means "no resend has happened", which
    // would make every older link valid again.
    const { store, close } = build();

    const thrown: unknown = await store
      .newestFor("user-1")
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(messagesOf(thrown)).toMatch(/ECONNREFUSED|connect/i);
    await close();
  });
});
