import { createBetterAuthVerificationMailer } from "./auth/adapters/better-auth-verification-mailer";
import type { AuthFactory } from "./auth/auth-factory";
import { createAuth, type CreateAuthInput } from "./auth/create-auth";
import type { EmailSender } from "./auth/ports/email-sender";
import type { VerificationMailer } from "./auth/resend-verification";
import { createDrizzleAccountDirectory } from "./adapters/drizzle-account-directory";
import { createDrizzleClaimFinaliser } from "./adapters/drizzle-claim-finaliser";
import { createDrizzleClaimStore } from "./adapters/drizzle-claim-store";
import { createDrizzleHandleRepository } from "./adapters/drizzle-handle-repository";
import { createDrizzleVerificationDispatchStore } from "./adapters/drizzle-verification-dispatch-store";
import type { Database } from "./db/client";
import type { AccountDirectory } from "./ports/account-directory";
import type { ClaimFinaliser } from "./ports/claim-finaliser";
import type { Clock } from "./ports/clock";
import type { ClaimStore } from "./ports/claim-store";
import type { HandleRepository } from "./ports/handle-repository";
import type { VerificationDispatchStore } from "./ports/verification-dispatch-store";

/**
 * Everything the domain needs from the outside world, supplied by the caller.
 */
export interface CoreDependencies {
  readonly clock: Clock;
  /**
   * The one Drizzle client for this process. Passed in rather than constructed
   * here, because the driver choice belongs to the deployment and
   * `createDatabase` needs a connection string this function has no business
   * reading.
   *
   * **It is a single field on purpose.** Better Auth's adapter and the Handle
   * repository must talk to the same database, and two fields that could hold
   * different clients would make that an accident waiting to happen rather
   * than an invariant — so `auth` takes everything *except* the client, and
   * this function supplies it to both.
   */
  readonly db: Database;
  /**
   * Everything `createAuth` needs except the three things this function owns:
   * the client, the dispatch store bound to it, and the `Clock` above.
   */
  readonly auth: Omit<CreateAuthInput, "db" | "dispatches" | "clock">;
}

/**
 * The wired domain surface that transport adapters call.
 */
export interface CoreServices {
  readonly clock: Clock;
  readonly auth: ReturnType<typeof createAuth>;
  /**
   * Issues a fresh verification link. Narrow on purpose: the resend use case
   * needs one verb from Better Auth, and a port with one verb is a port a test
   * can stand in for without standing up a library.
   */
  readonly verificationMailer: VerificationMailer;
  readonly handles: HandleRepository;
  /**
   * The Claim's unit of work. Separate from {@link handles}, which is read-only
   * by design: the writes exist only on the object the transaction hands out,
   * so nothing can write a hold without one.
   */
  readonly claims: ClaimStore;
  /**
   * The Claim's other unit of work: verification and finalisation together.
   * Separate from {@link claims} because the Claim has no business finalising
   * and the finalisation has no business creating an Account.
   */
  readonly claimFinaliser: ClaimFinaliser;
  /** Who an address belongs to, and which Handle is theirs. Read-only. */
  readonly accounts: AccountDirectory;
  /** Which verification links went out, and when. */
  readonly dispatches: VerificationDispatchStore;
  /**
   * The real sender, for the one email Better Auth does not send for us: the
   * "somebody tried to sign up with your address" notice
   * ([#15](https://github.com/joshstothard/3moji/issues/15)). It is handed out
   * **unwrapped**, because that email is sent after the claim transaction has
   * already rolled back — there is nothing left to defer it until.
   */
  readonly emailSender: EmailSender;
  /** The verified sender address, for copy that signs off with it. */
  readonly emailFrom: string;
  /**
   * Where somebody is sent to ask for a password reset.
   *
   * Derived here rather than composed at a call site, so there is one answer.
   * It is the **form**, not a tokenised link: the collision email is triggered
   * by an unauthenticated sign-up, so a tokenised link there would let a
   * stranger have live reset tokens mailed to somebody else's inbox.
   */
  readonly resetRequestUrl: string;
}

/**
 * The manual composition root.
 *
 * ADR-0006 decision 4 replaces runtime dependency injection with this function,
 * because Next.js route handlers and server actions have no container to wire
 * them. Dependencies are passed in and collaborators are constructed here, so
 * the domain never reaches out for one and every test can substitute a fake.
 *
 * Nothing else in the codebase should construct the auth instance: there is one
 * place to look when you need to know what depends on what.
 */
export function createCoreServices(deps: CoreDependencies): CoreServices {
  /**
   * Rebuilding auth against the claim transaction still happens *here*, in the
   * sense that matters: this closure is the only thing that reaches
   * `createAuth`, and it already holds the secret, base URL and sender address.
   * The claim adapter may vary the client and the email sender, and nothing
   * else.
   */
  const authFactory: AuthFactory = ({ db, emailSender, dispatches }) =>
    createAuth({
      ...deps.auth,
      db,
      emailSender,
      dispatches,
      clock: deps.clock,
    });

  const dispatches = createDrizzleVerificationDispatchStore({ db: deps.db });

  /** What both units of work need, and the only difference between them. */
  const transactional = {
    db: deps.db,
    auth: authFactory,
    emailSender: deps.auth.emailSender,
  };

  const auth = createAuth({
    ...deps.auth,
    db: deps.db,
    dispatches,
    clock: deps.clock,
  });

  return {
    clock: deps.clock,
    auth,
    verificationMailer: createBetterAuthVerificationMailer(auth),
    handles: createDrizzleHandleRepository(deps.db),
    claims: createDrizzleClaimStore(transactional),
    claimFinaliser: createDrizzleClaimFinaliser(transactional),
    accounts: createDrizzleAccountDirectory(deps.db),
    dispatches,
    emailSender: deps.auth.emailSender,
    emailFrom: deps.auth.from,
    resetRequestUrl: `${deps.auth.baseUrl.replace(/\/+$/, "")}/reset-password`,
  };
}
