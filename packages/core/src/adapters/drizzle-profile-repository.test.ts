import { createDatabase } from "../db/client";
import { toHandleKey, type HandleKey } from "../db/handle-key";

import { createDrizzleProfileRepository } from "./drizzle-profile-repository";

/** Resolves but refuses connections: every query fails at the socket. */
const URL = "postgresql://app:app@127.0.0.1:59999/app_test";

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

/**
 * A named guard rather than a cast: the package forbids both `any` and the
 * non-null assertion, so the impossible branch is spelled out.
 */
function keyOrThrow(handle: string): HandleKey {
  const key = toHandleKey(handle);
  if (key === undefined) {
    throw new Error(`not a claimable Handle: ${handle}`);
  }
  return key;
}

const KEY = keyOrThrow("🐙🐙🐙");

describe("createDrizzleProfileRepository against an unreachable database", () => {
  it("fails loudly rather than reporting no Profile", async () => {
    // `undefined` is a real answer with real consequences — it is what makes a
    // claimed Handle render as "claimed but unedited" — so an outage must not
    // be able to produce it. A stub that never queried would pass every
    // happy-path assertion and answer `undefined` for everybody in production.
    const handle = createDatabase({ url: URL });
    const repository = createDrizzleProfileRepository(handle.db);

    const thrown: unknown = await repository
      .profileOf(KEY)
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(messagesOf(thrown)).toMatch(/ECONNREFUSED|connect/i);
    await handle.close();
  });
});
