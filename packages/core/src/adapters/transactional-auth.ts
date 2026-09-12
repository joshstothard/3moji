import { createDeferredEmailSender } from "../auth/adapters/deferred-email-sender";
import type { Auth, AuthFactory } from "../auth/auth-factory";
import type { EmailSender } from "../auth/ports/email-sender";
import type { Database, DatabaseOrTransaction } from "../db/client";
import type { TransactionOutcome } from "../ports/claim-store";

import { createDrizzleVerificationDispatchStore } from "./drizzle-verification-dispatch-store";

/**
 * Rolls the transaction back and carries nothing.
 *
 * Drizzle commits when the callback returns and rolls back when it throws, so a
 * rejected unit of work has to throw *something* — and the verdict is already
 * held outside, in the {@link TransactionOutcome}. This type exists only so the
 * `catch` can tell "the domain said no" from "the database fell over" without
 * inspecting a message.
 */
class ClaimRolledBack extends Error {
  constructor() {
    super("the claim transaction was rolled back by the domain");
    this.name = "ClaimRolledBack";
  }
}

export interface TransactionalAuthInput {
  readonly db: Database;
  /** Rebuilds auth against the transaction. Supplied by the composition root. */
  readonly auth: AuthFactory;
  /** The real sender. Wrapped per transaction, never called during one. */
  readonly emailSender: EmailSender;
}

/**
 * Runs one transaction with an auth instance bound to it.
 *
 * **Shared by the two units of work that need Better Auth inside a
 * transaction** — the Claim (`user` and `account` rows beside the hold) and its
 * finalisation (`email_verified` beside `claimed_at`). Both need the same three
 * things, and none of the three is obvious enough to write twice:
 *
 * 1. **Auth rebound to the transaction.** Better Auth's Drizzle adapter issues
 *    every statement through the client it was constructed with, so an instance
 *    built on the pool would put its rows outside the transaction.
 * 2. **Email held until the commit.** An email cannot be rolled back. Better
 *    Auth sends from inside `signUpEmail`, so the sender is wrapped, flushed
 *    after a commit and discarded after a rollback.
 * 3. **The dispatch store bound to the same transaction**, for the same reason
 *    as auth: the `sendVerificationEmail` hook records the link it issued, and
 *    a row written outside would outlive the rollback and invalidate a link for
 *    a Claim that never happened.
 */
export async function runWithTransactionalAuth<T>(
  input: TransactionalAuthInput,
  work: (
    tx: DatabaseOrTransaction,
    auth: Auth,
  ) => Promise<TransactionOutcome<T>>,
): Promise<T> {
  const deferred = createDeferredEmailSender(input.emailSender);
  let outcome: TransactionOutcome<T> | undefined;

  try {
    await input.db.transaction(async (tx) => {
      const auth = input.auth({
        db: tx,
        emailSender: deferred,
        dispatches: createDrizzleVerificationDispatchStore({ db: tx }),
      });
      outcome = await work(tx, auth);
      if (!outcome.commit) {
        throw new ClaimRolledBack();
      }
    });
  } catch (error) {
    if (!(error instanceof ClaimRolledBack)) {
      // Nothing was committed, so nothing may be sent.
      deferred.discard();
      throw error;
    }
  }

  if (outcome === undefined) {
    throw new Error(
      "the claim transaction ended without a verdict. The callback must return a TransactionOutcome.",
    );
  }

  if (outcome.commit) {
    // After the commit, never inside it: an email cannot be rolled back.
    await deferred.flush();
  } else {
    deferred.discard();
  }

  return outcome.value;
}
