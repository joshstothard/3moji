import type { DatabaseOrTransaction } from "../db/client";
import type { VerificationDispatchStore } from "../ports/verification-dispatch-store";
import type { createAuth } from "./create-auth";
import type { EmailSender } from "./ports/email-sender";

/** The wired Better Auth instance. */
export type Auth = ReturnType<typeof createAuth>;

/** The three collaborators a Claim has to substitute for its transaction. */
export interface AuthFactoryInput {
  /** The transaction, so the `user` and `account` rows land inside it. */
  readonly db: DatabaseOrTransaction;
  /** The deferring sender, so a rolled-back Claim sends no email. */
  readonly emailSender: EmailSender;
  /**
   * The dispatch store bound to the same transaction, so a rolled-back Claim
   * records no link either. A row written outside would survive the rollback
   * and invalidate the previous link on behalf of a Claim that never happened.
   */
  readonly dispatches: VerificationDispatchStore;
}

/**
 * Rebuilds the auth instance against a transaction.
 *
 * **It exists so the composition root keeps its promise.** Better Auth's
 * adapter talks to whatever client it was handed, so an atomic Claim needs an
 * instance bound to the transaction — but "nothing else in the codebase
 * constructs the auth instance" has to stay true in substance, not just in
 * letter. So the composition root supplies this closure, already holding the
 * secret, the base URL and the sender address, and the claim adapter can only
 * vary the three things it has a reason to vary.
 */
export type AuthFactory = (input: AuthFactoryInput) => Auth;
