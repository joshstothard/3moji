import { DEFERRED_EMAIL_FAILURE_EVENTS } from "../auth/adapters/background-email-sender";
import { createDeferredEmailSender } from "../auth/adapters/deferred-email-sender";
import type { Auth, AuthFactory } from "../auth/auth-factory";
import type { EmailSender } from "../auth/ports/email-sender";
import type { BackgroundTasks } from "../ports/background-tasks";
import type { Database, DatabaseOrTransaction } from "../db/client";
import { toSafeDatabaseError } from "../db/database-error";
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
  /** Where the post-commit flush runs: after the answer, not inside it (#216). */
  readonly tasks: BackgroundTasks;
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
 * 2. **Email held until the commit, and sent after the answer.** An email
 *    cannot be rolled back. Better Auth sends from inside `signUpEmail`, so
 *    the sender is wrapped, flushed after a commit and discarded after a
 *    rollback — and the flush is handed to the background (#216), because a
 *    fresh Claim's verification email sent inside the request would make it
 *    the one branch of the Claim that waits on the email provider, or fails
 *    because of it.
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
      // Without the statement's bound parameters — the Claim's email address
      // among them — and with the SQLSTATE kept (#144). The `23505` branches
      // inside the unit of work have already seen the original.
      throw toSafeDatabaseError(error);
    }
  }

  if (outcome === undefined) {
    throw new Error(
      "the claim transaction ended without a verdict. The callback must return a TransactionOutcome.",
    );
  }

  if (outcome.commit) {
    // After the commit, never inside it: an email cannot be rolled back. And
    // after the answer (#216). **One task for the whole flush**, not one per
    // email: Next.js runs separate `after()` callbacks through a queue that is
    // not serial, and the held emails are ordered messages to one person.
    if (deferred.held.length > 0) {
      input.tasks.run(DEFERRED_EMAIL_FAILURE_EVENTS.claimVerification, () =>
        deferred.flush(),
      );
    }
  } else {
    deferred.discard();
  }

  return outcome.value;
}
