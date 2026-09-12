import { and, desc, eq, gte } from "drizzle-orm";

import type { DatabaseOrTransaction } from "../db/client";
import { verificationDispatch } from "../db/verification-dispatch";
import type {
  VerificationDispatch,
  VerificationDispatchStore,
} from "../ports/verification-dispatch-store";

/** Where the row ids come from. Injected so a test can make them predictable. */
export interface DrizzleVerificationDispatchStoreInput {
  readonly db: DatabaseOrTransaction;
  readonly newId?: () => string;
}

/**
 * {@link VerificationDispatchStore} over `verification_dispatch`.
 *
 * It takes a client **or a transaction**, and on the claim path it is given the
 * transaction: the dispatch is recorded by the `sendVerificationEmail` hook,
 * which Better Auth calls from inside sign-up, which is inside the Claim's
 * transaction. A store bound to the pooled client there would write a row that
 * survived the rollback and pinned a Claim that never happened.
 *
 * Every read is ordered newest-first and bounded, so none of them is a scan:
 * the two indexes on the table are exactly these three queries' shapes.
 */
export function createDrizzleVerificationDispatchStore(
  input: DrizzleVerificationDispatchStoreInput,
): VerificationDispatchStore {
  const { db } = input;
  const newId = input.newId ?? (() => crypto.randomUUID());

  return {
    async record(dispatch: VerificationDispatch): Promise<void> {
      await db.insert(verificationDispatch).values({
        id: newId(),
        userId: dispatch.userId,
        tokenHash: dispatch.tokenHash,
        // From the caller's Clock, never `defaultNow()`: the rate-limit window
        // is a domain rule and a SQL default would put it where no test can
        // move time.
        sentAt: dispatch.sentAt,
      });
    },

    async since(userId, since) {
      return db
        .select({
          userId: verificationDispatch.userId,
          tokenHash: verificationDispatch.tokenHash,
          sentAt: verificationDispatch.sentAt,
        })
        .from(verificationDispatch)
        .where(
          and(
            eq(verificationDispatch.userId, userId),
            gte(verificationDispatch.sentAt, since),
          ),
        )
        .orderBy(desc(verificationDispatch.sentAt));
    },

    async newestFor(userId) {
      const rows = await db
        .select({
          userId: verificationDispatch.userId,
          tokenHash: verificationDispatch.tokenHash,
          sentAt: verificationDispatch.sentAt,
        })
        .from(verificationDispatch)
        .where(eq(verificationDispatch.userId, userId))
        .orderBy(desc(verificationDispatch.sentAt))
        .limit(1);
      return rows[0];
    },

    async findByTokenHash(tokenHash) {
      const rows = await db
        .select({
          userId: verificationDispatch.userId,
          tokenHash: verificationDispatch.tokenHash,
          sentAt: verificationDispatch.sentAt,
        })
        .from(verificationDispatch)
        .where(eq(verificationDispatch.tokenHash, tokenHash))
        // Newest first, because the fingerprint is deliberately not unique:
        // two links signed for one address inside one second are identical.
        .orderBy(desc(verificationDispatch.sentAt))
        .limit(1);
      return rows[0];
    },
  };
}
