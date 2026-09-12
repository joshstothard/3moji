import { createInMemoryVerificationDispatchStore } from "./in-memory-verification-dispatch-store";
import type { AuthFactory } from "../auth/auth-factory";
import { createRecordingEmailSender } from "../auth/adapters/recording-email-sender";
import { createAuth } from "../auth/create-auth";
import { createDatabase } from "../db/client";
import { toHandleKey } from "../db/handle-key";
import {
  createDrizzleClaimFinaliser,
  finaliserTransactionOn,
} from "./drizzle-claim-finaliser";

/** Resolves but refuses connections. Nothing here opens a socket successfully. */
const URL = "postgresql://app:app@127.0.0.1:59999/app_test";
const NOW = new Date("2026-09-12T12:00:00.000Z");

const KEY = toHandleKey("\u{1F9CA}\u{1F9CA}\u{1F9CA}");
if (KEY === undefined) throw new Error("the test Handle must canonicalise");

const messageOf = (error: unknown): string =>
  typeof error === "object" &&
  error !== null &&
  "message" in error &&
  typeof error.message === "string"
    ? error.message
    : `not an error: ${String(error)}`;

const causeOf = (error: unknown): unknown =>
  typeof error === "object" && error !== null && "cause" in error
    ? error.cause
    : undefined;

const messagesOf = (error: unknown, depth = 0): string =>
  depth > 8
    ? ""
    : `${messageOf(error)} ${
        causeOf(error) === undefined
          ? ""
          : messagesOf(causeOf(error), depth + 1)
      }`;

const authFactory: AuthFactory = ({ db, emailSender, dispatches }) =>
  createAuth({
    db,
    emailSender,
    dispatches,
    clock: { now: () => NOW },
    baseUrl: "http://localhost:3000",
    secret: "a".repeat(32),
    from: "3moji <no-reply@mail.3moji.me>",
  });

const build = (driver: "neon-http" | "node-postgres") => {
  const handle = createDatabase({ url: URL, driver });
  return {
    close: handle.close,
    finaliser: createDrizzleClaimFinaliser({
      db: handle.db,
      auth: authFactory,
      emailSender: createRecordingEmailSender(),
    }),
    tx: finaliserTransactionOn(
      handle.db,
      authFactory({
        db: handle.db,
        emailSender: createRecordingEmailSender(),
        dispatches: createInMemoryVerificationDispatchStore(),
      }),
    ),
  };
};

describe("createDrizzleClaimFinaliser", () => {
  /**
   * ADR-0006 decision 6 puts production on `neon-http`, which has no
   * interactive transactions ([#89](https://github.com/joshstothard/3moji/issues/89)).
   * The finalisation shares the Claim's plumbing, so it shares the diagnosis:
   * a reader must be sent to the driver rather than to this file.
   */
  it("explains itself when the driver has no interactive transactions", async () => {
    const { finaliser, close } = build("neon-http");

    await expect(
      finaliser.runInTransaction(() =>
        Promise.resolve({ commit: true, value: "unreachable" }),
      ),
    ).rejects.toThrow(/neon-serverless.+new ADR|ADR-0006 decision 6/s);

    await close();
  });

  it("propagates an unreachable database rather than reporting no hold", async () => {
    // `no-hold` would send somebody to "pick another Handle" because the
    // database was briefly down. The two must never be the same answer.
    const { tx, close } = build("node-postgres");

    const thrown: unknown = await tx
      .finaliseHold("user-1", NOW)
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(messagesOf(thrown)).toMatch(/ECONNREFUSED|connect/i);
    await close();
  });

  it("rejects a token that is not ours without touching the database", async () => {
    // **This is the one test that proves the error narrowing works.** Better
    // Auth raises its `APIError` from inside an ESM realm of its own, so
    // `instanceof APIError` silently fails there — `quality-strategy.md`
    // records the same trap making `toBeInstanceOf(Error)` report "Expected
    // constructor: Error, Received constructor: Error". The narrowing in
    // `isRejectedToken` reads properties instead, and only a real Better Auth
    // error can show that it reads the right ones.
    //
    // It also shows the signature is checked before any query: the database
    // here refuses every connection, and a forged token is still answered.
    const { tx, close } = build("node-postgres");

    const result = await tx.verifyEmail("not.a.real.jwt");

    expect(result).toEqual({ ok: false, reason: "rejected" });
    await close();
  });

  it("propagates an unreachable database rather than reporting a rejected link", async () => {
    // `rejected` renders "that link expired, here is a new one". An outage
    // rendered as an expired link would send everybody round a loop that cannot
    // end, so the hold read must fail rather than answer.
    const { tx, close } = build("node-postgres");

    const thrown: unknown = await tx
      .finaliseHold("user-1", NOW)
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(messagesOf(thrown)).toMatch(/ECONNREFUSED|connect/i);
    await close();
  });
});
