import { and, eq, isNull, lte } from "drizzle-orm";

import type { Auth, AuthFactory } from "../auth/auth-factory";
import type { EmailSender } from "../auth/ports/email-sender";
import type { Database, DatabaseOrTransaction } from "../db/client";
import { handle } from "../db/handle";
import type { HandleKey } from "../db/handle-key";
import { postgresErrorCode, UNIQUE_VIOLATION } from "../db/postgres-error";
import { user } from "../db/schema";
import type {
  AccountCreated,
  AccountToCreate,
  ClaimStore,
  ClaimTransaction,
  ExpiredHoldFreed,
  HoldToWrite,
  HoldWritten,
  TransactionOutcome,
} from "../ports/claim-store";

import { createDrizzleHandleRepository } from "./drizzle-handle-repository";
import { runWithTransactionalAuth } from "./transactional-auth";

export interface DrizzleClaimStoreInput {
  readonly db: Database;
  /** Rebuilds auth against the transaction. Supplied by the composition root. */
  readonly auth: AuthFactory;
  /** The real sender. Wrapped per transaction, never called during one. */
  readonly emailSender: EmailSender;
}

/** Better Auth's own default, and the shortest password it will accept. */
const MINIMUM_PASSWORD_LENGTH = 8;

/**
 * {@link ClaimStore} over one Postgres transaction.
 *
 * ## Why account creation happens through a rebuilt auth instance
 *
 * ADR-0004 decision 4 makes the Account and the hold one atomic act. Better
 * Auth owns the `user` and `account` rows — including the password hash, which
 * we must not reimplement — and its Drizzle adapter issues every statement
 * through the client it was constructed with. Binding a fresh instance to the
 * transaction is therefore the only way to get its writes and ours into the
 * same one. The alternative, signing up first and deleting the Account if the
 * hold fails, is a compensating write rather than a transaction: a process that
 * dies between the two leaves exactly the handle-less Account the invariant
 * forbids.
 *
 * ## One driver, in every environment
 *
 * This needs an interactive transaction, and it gets one everywhere: ADR-0010
 * puts local development, CI and production on `node-postgres`. It previously
 * could not have run in production at all — ADR-0006 decision 6 selected
 * Neon's HTTP driver, which throws "No transactions support in neon-http
 * driver" — and nothing caught it because CI exercised a different driver from
 * production. That divergence is gone, so this path is exercised by the same
 * driver that serves it.
 */
export function createDrizzleClaimStore(
  input: DrizzleClaimStoreInput,
): ClaimStore {
  return {
    runInTransaction<T>(
      work: (tx: ClaimTransaction) => Promise<TransactionOutcome<T>>,
    ): Promise<T> {
      // The transaction, the rebound auth instance, the deferred sender and the
      // transaction-bound dispatch store all come from the shared helper — the
      // finaliser needs exactly the same four and none of them is obvious
      // enough to have two copies of.
      return runWithTransactionalAuth(input, (tx, auth) =>
        work(claimTransactionOn(tx, auth)),
      );
    },
  };
}

/**
 * The reads and writes of one Claim, bound to one transaction.
 *
 * Availability is read through {@link createDrizzleHandleRepository} rather than
 * a second query, so the Claim and the resolve path cannot come to different
 * conclusions about the same row — the hold-expiry rule has exactly one
 * implementation, and it is the unit-tested one.
 *
 * **Exported for its own tests, not for callers.** It is reachable only from
 * {@link createDrizzleClaimStore} in production, and `ClaimStore` is what the
 * domain depends on. The tests that need it directly are the ones proving this
 * object does not *swallow* failures — that an unreachable database is not
 * reported as an available Handle, and that a connection drop is not read as a
 * rejected constraint — and those want no transaction in the way.
 */
export function claimTransactionOn(
  tx: DatabaseOrTransaction,
  auth: Auth,
): ClaimTransaction {
  const handles = createDrizzleHandleRepository(tx);

  return {
    availabilityOf: (key, now) => handles.availabilityOf(key, now),

    /**
     * The write side of lazy expiry: delete the unverified Account whose hold
     * on this key has died, and let the Handle cascade away with it.
     *
     * **It deletes a `user` row, not a `handle` row.** `handle.user_id`
     * references `user.id` `ON DELETE CASCADE`, so deleting the Account is
     * what frees the Handle — and ADR-0004 decision 5 says an unverified
     * Account whose hold expires is deleted alongside it, so the Handle row
     * alone would leave exactly the handle-less Account decision 4 forbids.
     * Better Auth's `session` and `account` rows cascade from `user` too, so
     * the credential row goes with it.
     *
     * **The predicate is `claimed_at IS NULL AND held_until <= now`, and both
     * halves are load-bearing.** `claimed_at IS NULL` is what "still held"
     * means, so a verified Account is untouchable however long ago its
     * `held_until` passed; `<=` rather than `<` matches
     * {@link ownershipOf}, which treats the expiry instant itself as expired.
     * `now` comes from the caller's injected `Clock`, never `now()` in SQL.
     *
     * **`FOR UPDATE` rather than a bare read.** Verification sets `claimed_at`
     * on this row, and under `READ COMMITTED` a plain `SELECT` could see a
     * version that a concurrent transaction is about to finalise. Locking the
     * row makes the concurrent write wait, and Postgres re-evaluates this
     * `WHERE` against the new version once the lock is granted — so a
     * just-verified row stops matching instead of being deleted. Nothing sets
     * `claimed_at` until #82 exists, so no test can contend for it today; the
     * lock is here because the window is real, not because it is covered.
     */
    async freeExpiredHold(
      key: HandleKey,
      now: Date,
    ): Promise<ExpiredHoldFreed> {
      const expired = await tx
        .select({ userId: handle.userId })
        .from(handle)
        .where(
          and(
            eq(handle.key, key),
            isNull(handle.claimedAt),
            lte(handle.heldUntil, now),
          ),
        )
        .limit(1)
        .for("update");

      const row = expired[0];
      if (row === undefined) {
        return { freed: false };
      }

      await tx.delete(user).where(eq(user.id, row.userId));
      return { freed: true };
    },

    async createAccount(account: AccountToCreate): Promise<AccountCreated> {
      // Read, rather than infer from the sign-up response. Better Auth returns
      // a synthetic success for an already-registered address on purpose (#15),
      // so its return value cannot distinguish the two — and this read is
      // inside the transaction, which is where the decision has to be made.
      const existing = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, account.email))
        .limit(1);
      if (existing.length > 0) {
        // **Dummy work, deliberately.** The Claim answers an already-registered
        // address with the same hold screen a fresh sign-up gets (#15), and a
        // response body that gives nothing away is worthless if the *timing*
        // does: a fresh Claim hashes a password, and hashing is by far the
        // slowest thing on this path. So it is hashed here too, and the result
        // thrown away. Better Auth's own sign-in does exactly this when it
        // finds no credential — `await ctx.context.password.hash(password)` —
        // and for exactly the same reason.
        const { password } = await auth.$context;
        await password.hash(account.password);
        return { ok: false, reason: "email-taken" };
      }

      if (account.password.length < MINIMUM_PASSWORD_LENGTH) {
        // Better Auth would throw here; rejecting first keeps the transaction
        // from aborting on an error that is really a validation answer.
        throw new Error(
          `a password of at least ${String(MINIMUM_PASSWORD_LENGTH)} characters is required.`,
        );
      }

      try {
        await auth.api.signUpEmail({
          body: {
            email: account.email,
            password: account.password,
            name: account.name,
          },
        });
      } catch (error) {
        // The read above cannot see another transaction's uncommitted row, so
        // two Claims submitted with the *same* address at the same time both
        // reach this insert and `user.email`'s unique index decides. That is
        // the same answer as the read: the address is taken, and nothing is
        // created either way.
        if (postgresErrorCode(error) === UNIQUE_VIOLATION) {
          return { ok: false, reason: "email-taken" };
        }
        throw error;
      }

      // Read back rather than trusting the response shape: the row is what the
      // Handle's foreign key needs, and it is in this transaction already.
      const created = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, account.email))
        .limit(1);
      const row = created[0];
      if (row === undefined) {
        // Deliberately loud rather than read as "the address is taken". It is
        // reachable only if Better Auth reported success while inserting
        // nothing this transaction can see — which the same-email race above
        // could produce if Better Auth swallows the unique violation instead
        // of surfacing it. Guessing which would hide a library defect behind a
        // routine-looking answer; the invariant is safe either way, because
        // nothing is committed.
        throw new Error(
          "sign-up reported success but no user row is visible in the claim transaction.",
        );
      }
      return { ok: true, userId: row.id };
    },

    async holdHandle(hold: HoldToWrite): Promise<HoldWritten> {
      try {
        await tx.insert(handle).values({
          key: hold.key,
          userId: hold.userId,
          // From the injected Clock, never now() + interval: the 24-hour rule
          // is a domain rule and the column has no SQL default on purpose.
          heldUntil: hold.heldUntil,
        });
        return { ok: true };
      } catch (error) {
        if (postgresErrorCode(error) === UNIQUE_VIOLATION) {
          // The primary key had the last word — ADR-0004 decision 7's third
          // layer. The transaction is aborted now, so the caller must roll
          // back rather than try anything else.
          return { ok: false, reason: "key-taken" };
        }
        throw error;
      }
    },
  };
}
