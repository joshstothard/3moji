import { createDatabase } from "../db/client";
import { createDrizzleClaimRateLimitStore } from "./drizzle-claim-rate-limit-store";

/**
 * A URL that resolves but refuses connections, so every statement fails at the
 * socket. What is under test is that the limiter's store **fails loudly** — the
 * Claim fails closed on that rejection — rather than answering with a count it
 * never read.
 *
 * The behaviour against a database that answers, including the atomic
 * increment under concurrency, is `claim-rate-limit.integration.test.ts`'s, in
 * CI.
 */
const URL = "postgresql://app:app@127.0.0.1:59999/app_test";
const WINDOW = new Date("2026-09-13T12:00:00.000Z");

describe("createDrizzleClaimRateLimitStore", () => {
  it("rejects when the database cannot be reached, rather than answering a count", async () => {
    const handle = createDatabase({ url: URL });
    const store = createDrizzleClaimRateLimitStore({ db: handle.db });

    try {
      await expect(
        store.record(
          [
            { bucket: "client:aa", windowStart: WINDOW },
            { bucket: "email:bb", windowStart: WINDOW },
          ],
          WINDOW,
        ),
      ).rejects.toBeDefined();
    } finally {
      await handle.close();
    }
  });

  it("issues no statement for nothing to count", async () => {
    const handle = createDatabase({ url: URL });
    const store = createDrizzleClaimRateLimitStore({ db: handle.db });

    try {
      // The database is unreachable, so resolving proves nothing was sent.
      await expect(store.record([], WINDOW)).resolves.toEqual([]);
    } finally {
      await handle.close();
    }
  });
});
