import { createDatabase } from "../db/client";
import { createDrizzleAccountDirectory } from "./drizzle-account-directory";

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

const build = () => {
  const handle = createDatabase({ url: URL });
  return {
    directory: createDrizzleAccountDirectory(handle.db),
    close: handle.close,
  };
};

describe("createDrizzleAccountDirectory against an unreachable database", () => {
  it("fails loudly on byEmail rather than reporting no such Account", async () => {
    // "No Account" is a real answer with real consequences — it is the branch
    // where a resend sends nothing and says `sent` — so an outage must not be
    // able to produce it.
    const { directory, close } = build();

    const thrown: unknown = await directory
      .byEmail("someone@example.com")
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(messagesOf(thrown)).toMatch(/ECONNREFUSED|connect/i);
    await close();
  });

  it("fails loudly on handleOf rather than reporting no Handle", async () => {
    const { directory, close } = build();

    const thrown: unknown = await directory
      .handleOf("user-1")
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(messagesOf(thrown)).toMatch(/ECONNREFUSED|connect/i);
    await close();
  });
});
