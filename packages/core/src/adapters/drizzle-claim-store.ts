import { eq } from "drizzle-orm";

import { createDeferredEmailSender } from "../auth/adapters/deferred-email-sender";
import type { Auth, AuthFactory } from "../auth/auth-factory";
import type { EmailSender } from "../auth/ports/email-sender";
import type { Database, DatabaseOrTransaction } from "../db/client";
import { handle } from "../db/handle";
import { postgresErrorCode, UNIQUE_VIOLATION } from "../db/postgres-error";
import { user } from "../db/schema";
import type {
  AccountCreated,
  AccountToCreate,
  ClaimStore,
  ClaimTransaction,
  HoldToWrite,
  HoldWritten,
  TransactionOutcome,
} from "../ports/claim-store";

import { createDrizzleHandleRepository } from "./drizzle-handle-repository";

export interface DrizzleClaimStoreInput {
  readonly db: Database;
  /** Rebuilds auth against the transaction. Supplied by the composition root. */
  readonly auth: AuthFactory;
  /** The real sender. Wrapped per transaction, never called during one. */
  readonly emailSender: EmailSender;
}

/**
 * Rolls the claim transaction back and carries nothing.
 *
 * Drizzle commits when the callback returns and rolls back when it throws, so a
 * rejected Claim has to throw *something* — and the verdict is already held
 * outside, in the {@link TransactionOutcome}. This type exists only so the
 * `catch` can tell "the domain said no" from "the database fell over" without
 * inspecting a message.
 */
class ClaimRolledBack extends Error {
  constructor() {
    super("the claim transaction was rolled back by the domain");
    this.name = "ClaimRolledBack";
  }
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
 * ## The neon-http problem, stated rather than hidden
 *
 * `drizzle-orm/neon-http` has no interactive transactions — it throws "No
 * transactions support in neon-http driver" — and ADR-0006 decision 6 puts
 * production on that driver. So this path cannot run in production as
 * configured today. Nothing calls it in production yet (the claim UI is #78-#82
 * and there is no server action), and the hosting report named this exact
 * trigger in advance: "what would change it: needing interactive transactions
 * in request handlers (then switch to `neon-serverless` over WebSockets, still
 * Neon)". That switch is a change to an accepted ADR's decision and therefore
 * needs a new ADR, which is not this issue's to write. Until it is made, the
 * failure is translated into the diagnosis rather than surfacing as a raw
 * driver message in a 500.
 */
export function createDrizzleClaimStore(
  input: DrizzleClaimStoreInput,
): ClaimStore {
  const { db, auth: authFactory, emailSender } = input;

  return {
    async runInTransaction<T>(
      work: (tx: ClaimTransaction) => Promise<TransactionOutcome<T>>,
    ): Promise<T> {
      const deferred = createDeferredEmailSender(emailSender);
      let outcome: TransactionOutcome<T> | undefined;

      try {
        await db.transaction(async (tx) => {
          const auth = authFactory({ db: tx, emailSender: deferred });
          outcome = await work(claimTransactionOn(tx, auth));
          if (!outcome.commit) {
            throw new ClaimRolledBack();
          }
        });
      } catch (error) {
        if (!(error instanceof ClaimRolledBack)) {
          // Nothing was committed, so nothing may be sent.
          deferred.discard();
          throw interactiveTransactionsUnsupported(error) ?? error;
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
    },
  };
}

/**
 * Turns the neon-http driver's refusal into something a reader can act on.
 *
 * Matching on the driver's message is not a load-bearing decision — the error
 * propagates either way, and only the wording of the diagnosis depends on it.
 * A silent 500 saying "No transactions support in neon-http driver" would send
 * whoever reads it looking for a bug in this file rather than at the driver
 * ADR-0006 decision 6 selected.
 */
function interactiveTransactionsUnsupported(error: unknown): Error | undefined {
  if (
    !(error instanceof Error) ||
    !error.message.includes("No transactions support")
  ) {
    return undefined;
  }
  return new Error(
    "The Claim needs an interactive transaction, which the neon-http driver does not provide. " +
      "ADR-0006 decision 6 selects that driver for production; switching this deployment to " +
      "drizzle-orm/neon-serverless (WebSockets, still Neon) is the documented remedy and needs a new ADR. " +
      "Locally and in CI, resolveDriver gives node-postgres, which does support it.",
    { cause: error },
  );
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
        return { ok: false, reason: "email-taken" };
      }

      if (account.password.length < MINIMUM_PASSWORD_LENGTH) {
        // Better Auth would throw here; rejecting first keeps the transaction
        // from aborting on an error that is really a validation answer.
        throw new Error(
          `a password of at least ${String(MINIMUM_PASSWORD_LENGTH)} characters is required.`,
        );
      }

      await auth.api.signUpEmail({
        body: {
          email: account.email,
          password: account.password,
          name: account.name,
        },
      });

      // Read back rather than trusting the response shape: the row is what the
      // Handle's foreign key needs, and it is in this transaction already.
      const created = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, account.email))
        .limit(1);
      const row = created[0];
      if (row === undefined) {
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
