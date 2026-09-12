import { eq } from "drizzle-orm";

import type { Database, DatabaseOrTransaction } from "../db/client";
import { handle } from "../db/handle";
import type { HandleKey } from "../db/handle-key";
import { releasedHandle } from "../db/released-handle";
import { user } from "../db/schema";
import type { TransactionOutcome } from "../ports/claim-store";
import type {
  ReleasedHandle,
  ReleaseStore,
  ReleaseTransaction,
} from "../ports/release-store";

/**
 * Rolls the transaction back and carries nothing.
 *
 * The same device `transactional-auth.ts` uses, for the same reason: Drizzle
 * commits when the callback returns and rolls back when it throws, so a
 * rejected unit of work has to throw *something* while the verdict is held
 * outside in the {@link TransactionOutcome}. It is a second small class rather
 * than a shared one because the Release does **not** use
 * `runWithTransactionalAuth` — see {@link createDrizzleReleaseStore}.
 */
class ReleaseRolledBack extends Error {
  constructor() {
    super("the release transaction was rolled back by the domain");
    this.name = "ReleaseRolledBack";
  }
}

export interface DrizzleReleaseStoreInput {
  readonly db: Database;
  /** Where the tombstone's row id comes from. Injected so a test can pin it. */
  readonly newId?: () => string;
}

/**
 * {@link ReleaseStore} over one Postgres transaction.
 *
 * ## Why Better Auth is not rebound here
 *
 * The Claim needs `runWithTransactionalAuth` because Better Auth writes the
 * `user` and `account` rows and sends the verification email from inside
 * sign-up. A Release writes neither and sends nothing: it deletes a `user` row
 * and inserts a tombstone. So this opens a plain transaction, and Better Auth's
 * own `deleteUser` API is deliberately bypassed — **a judgement call**, because
 * it means no library hook fires on deletion. What the deletion actually needs
 * is the cascade, and that is declared on the columns: `session`, `account`,
 * `verification_dispatch` and `handle` all reference `user.id`
 * `ON DELETE CASCADE`, and Phase 4's Profile and Links will hang off the same
 * row. `freeExpiredHold` already deletes a `user` row this way for the same
 * reason.
 */
export function createDrizzleReleaseStore(
  input: DrizzleReleaseStoreInput,
): ReleaseStore {
  const newId = input.newId ?? (() => crypto.randomUUID());

  return {
    async runInTransaction<T>(
      work: (tx: ReleaseTransaction) => Promise<TransactionOutcome<T>>,
    ): Promise<T> {
      let outcome: TransactionOutcome<T> | undefined;

      try {
        await input.db.transaction(async (tx) => {
          outcome = await work(releaseTransactionOn(tx, newId));
          if (!outcome.commit) {
            throw new ReleaseRolledBack();
          }
        });
      } catch (error) {
        if (!(error instanceof ReleaseRolledBack)) {
          throw error;
        }
      }

      if (outcome === undefined) {
        throw new Error(
          "the release transaction ended without a verdict. The callback must return a TransactionOutcome.",
        );
      }

      return outcome.value;
    },
  };
}

/**
 * The reads and writes of one Release, bound to one transaction.
 *
 * **Exported for its own tests, not for callers.** In production it is reached
 * only from {@link createDrizzleReleaseStore}, and `ReleaseStore` is what the
 * domain depends on. The test that needs it directly is the one proving the
 * tombstone write actually reaches the table — an end-to-end assertion can go
 * green with the write never having run, which is the vacuity
 * [#83](https://github.com/joshstothard/3moji/issues/83) found in its own
 * predicate, so `recordRelease` is also called on its own and read back.
 */
export function releaseTransactionOn(
  tx: DatabaseOrTransaction,
  newId: () => string = () => crypto.randomUUID(),
): ReleaseTransaction {
  return {
    /**
     * The Handle this Account owns, read **before** anything is deleted.
     * `handle.user_id` is `UNIQUE`, so there is at most one row to find
     * (ADR-0004 decision 4), and it cascades from `user`, so after the delete
     * there is no key left to read.
     *
     * **`FOR UPDATE` rather than a bare read**, for the same reason
     * `freeExpiredHold` locks: two Releases of the same Account issued at once
     * would both see this row under `READ COMMITTED` — a plain `SELECT` does
     * not wait on a concurrent delete — and both would write a tombstone for
     * one Release. Locking makes the second wait; Postgres then re-evaluates
     * the `WHERE` against the new version, finds the row gone with the
     * cascade, and the second Release answers `no-handle` and writes nothing.
     * Nothing can contend for it until an account surface exists to double-
     * submit from, so the lock is here because the window is real, not because
     * a test covers it.
     */
    async handleOf(userId: string): Promise<HandleKey | undefined> {
      const rows = await tx
        .select({ key: handle.key })
        .from(handle)
        .where(eq(handle.userId, userId))
        .limit(1)
        .for("update");
      return rows[0]?.key;
    },

    /**
     * The tombstone: the key, the time, and the row's own id. **Nothing that
     * names the Account** — ADR-0009 decision 3, which the table's own comment
     * and its column set both restate, because this is the line a later
     * convenience would cross.
     */
    async recordRelease(tombstone: ReleasedHandle): Promise<void> {
      await tx.insert(releasedHandle).values({
        id: newId(),
        key: tombstone.key,
        // From the caller's Clock, never `defaultNow()`: a future cooldown is
        // dated from this, and a SQL default would put it where no test can
        // move time.
        releasedAt: tombstone.releasedAt,
      });
    },

    /**
     * Release *is* account deletion (ADR-0004 decision 5), so what is deleted
     * is the `user` row and everything cascading from it — the Handle
     * included. Deleting the Handle row instead would leave exactly the
     * handle-less Account decision 4 forbids.
     */
    async deleteAccount(userId: string): Promise<void> {
      await tx.delete(user).where(eq(user.id, userId));
    },
  };
}
