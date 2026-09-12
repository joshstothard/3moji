import { and, eq, isNull } from "drizzle-orm";

import type { Auth } from "../auth/auth-factory";
import type { DatabaseOrTransaction } from "../db/client";
import { handle } from "../db/handle";
import { ownershipOf } from "../handle/handle-ownership";
import type {
  ClaimFinaliser,
  ClaimFinaliserTransaction,
  EmailVerification,
  HoldFinalised,
} from "../ports/claim-finaliser";
import type { TransactionOutcome } from "../ports/claim-store";

import {
  runWithTransactionalAuth,
  type TransactionalAuthInput,
} from "./transactional-auth";

/**
 * {@link ClaimFinaliser} over one Postgres transaction.
 *
 * Verification and finalisation are one act: `handle.claimed_at` is what
 * ownership *means*, so an address verified without it leaves a Handle that
 * still reads as held and that lazy expiry
 * ([#83](https://github.com/joshstothard/3moji/issues/83)) will free out from
 * under its rightful owner. Two statements with a network between them make
 * that outcome a matter of luck; one transaction makes it impossible.
 *
 * It shares its plumbing with the Claim — see
 * {@link ./transactional-auth.runWithTransactionalAuth} — because both need
 * Better Auth rebound to the transaction, on the same single driver (ADR-0010)
 * to both ([#89](https://github.com/joshstothard/3moji/issues/89)).
 */
export function createDrizzleClaimFinaliser(
  input: TransactionalAuthInput,
): ClaimFinaliser {
  return {
    runInTransaction<T>(
      work: (tx: ClaimFinaliserTransaction) => Promise<TransactionOutcome<T>>,
    ): Promise<T> {
      return runWithTransactionalAuth(input, (tx, auth) =>
        work(finaliserTransactionOn(tx, auth)),
      );
    },
  };
}

/**
 * The reads and writes of one finalisation, bound to one transaction.
 *
 * **Exported for its own tests, not for callers.** In production it is reachable
 * only from {@link createDrizzleClaimFinaliser}, and `ClaimFinaliser` is what
 * the domain depends on.
 */
export function finaliserTransactionOn(
  tx: DatabaseOrTransaction,
  auth: Auth,
): ClaimFinaliserTransaction {
  return {
    async verifyEmail(token: string): Promise<EmailVerification> {
      try {
        // `returnHeaders`, because the headers *are* the sign-in: with
        // `autoSignInAfterVerification` Better Auth sets a session cookie here,
        // and a caller that reads only the JSON body verifies the address and
        // signs nobody in.
        //
        // No `callbackURL` is passed on purpose. Better Auth redirects to one
        // on failure — `?error=token_expired` — which would turn an expired
        // link into a 302 whose token is gone, and the token is how we know
        // whose link it was. Without it, a rejection is an exception we can
        // answer properly.
        const { headers } = await auth.api.verifyEmail({
          query: { token },
          returnHeaders: true,
        });

        return {
          ok: true,
          headers,
          // **A session cookie is the signal, not the response body.** Better
          // Auth answers the second click of a working link with `user: null`
          // and no session, and answers a first click with a session — but
          // `user` is not on the endpoint's declared return type, so reading it
          // would mean asserting a shape the library does not promise. The
          // cookie is the thing that actually matters here anyway: it *is* the
          // sign-in that `autoSignInAfterVerification` exists to perform.
          signedIn: headers.has("set-cookie"),
        };
      } catch (error) {
        if (isRejectedToken(error)) {
          return { ok: false, reason: "rejected" };
        }
        throw error;
      }
    },

    async finaliseHold(userId: string, at: Date): Promise<HoldFinalised> {
      // Read, decide, then write — inside one transaction, so the read cannot
      // go stale before the write. A single conditional `UPDATE` would be one
      // statement fewer and would put the hold-expiry rule in SQL, where the
      // rule already has an implementation: `ownershipOf`. Two callers with two
      // spellings of "expired" is how a Handle ends up both held and available.
      const rows = await tx
        .select({
          key: handle.key,
          heldUntil: handle.heldUntil,
          claimedAt: handle.claimedAt,
        })
        .from(handle)
        // `handle.user_id` is UNIQUE, so this is an index seek on one row.
        .where(eq(handle.userId, userId))
        .limit(1);

      const row = rows[0];
      if (row === undefined) return { ok: false, reason: "no-hold" };

      const ownership = ownershipOf(row, at);

      // `available` here means the hold died while its row sat there — expiry
      // is lazy and #83 owns the freeing. Finalising it would resurrect a
      // Handle somebody else is now entitled to take.
      if (ownership === "available") {
        return { ok: false, reason: "hold-expired" };
      }

      // Already final: the second click of a working link. Left untouched, so
      // the instant it became final is the original one — ADR-0004 decision 6
      // has this row mutate exactly once.
      if (ownership === "claimed") return { ok: true, key: row.key };

      await tx
        .update(handle)
        .set({ claimedAt: at })
        .where(and(eq(handle.userId, userId), isNull(handle.claimedAt)));

      return { ok: true, key: row.key };
    },
  };
}

/**
 * Whether Better Auth refused the token, as opposed to the database falling
 * over.
 *
 * **Not `instanceof APIError`.** `--experimental-vm-modules` runs ESM in its own
 * realm, so a class raised inside the library is not the test realm's class and
 * the check silently fails — `quality-strategy.md` records this trap costing a
 * suite an afternoon with "Expected constructor: Error, Received constructor:
 * Error". The narrowing is spelled out over the two properties Better Auth's
 * `APIError` actually carries.
 */
function isRejectedToken(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;

  const status = "status" in error ? error.status : undefined;
  if (status === "UNAUTHORIZED" || status === 401) return true;

  // Some versions carry the code in the body rather than the status.
  if (
    !("body" in error) ||
    typeof error.body !== "object" ||
    error.body === null
  ) {
    return false;
  }
  const code = "code" in error.body ? error.body.code : undefined;
  return (
    typeof code === "string" &&
    ["TOKEN_EXPIRED", "INVALID_TOKEN", "USER_NOT_FOUND"].includes(code)
  );
}
