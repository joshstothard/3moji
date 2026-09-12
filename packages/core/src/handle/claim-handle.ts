import type { Clock } from "../ports/clock";
import type { ClaimStore } from "../ports/claim-store";
import { handleKeyOf } from "../db/handle-key";
import type { CanonicalHandle, CanonicalisationFailure } from "./canonicalise";
import { canonicalHandleOf, claimableHandle } from "./claimable";
import {
  RESERVED_HANDLES,
  reservationOf,
  type Reservation,
  type ReservedHandleList,
} from "./reserved-handles";

/**
 * How long a Claim holds its Handle: 24 hours, ADR-0004 decision 3.
 *
 * A named domain constant rather than a SQL default, because the column
 * deliberately has none — `held_until` is computed from the injected `Clock`
 * so a test can move time.
 */
export const HOLD_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * What a Claim attempt is told.
 *
 * `already-registered` is the one answer the transport must **not** pass
 * through. Better Auth returns a synthetic success for an already-registered
 * address so the response cannot be used to enumerate accounts (#15), and the
 * UI owes the submitter the same hold screen a new sign-up gets. The domain
 * still says what happened, because a layer that lies to itself cannot be
 * tested, and because #82 has to send the existing address the "someone tried
 * to sign up" email that path calls for.
 */
export type ClaimResult =
  | {
      readonly state: "held";
      readonly handle: CanonicalHandle;
      readonly heldUntil: Date;
    }
  | {
      readonly state: "taken";
      readonly handle: CanonicalHandle;
      /**
       * `held` and `claimed` are what the in-transaction read found.
       * `write-rejected` is the primary key having the last word after that
       * read said `available`: a **race** lost between the read and the
       * insert. An expired hold is no longer one of the possibilities — the
       * same transaction freed it a few lines earlier
       * ([#83](https://github.com/joshstothard/3moji/issues/83)).
       */
      readonly because: "held" | "claimed" | "write-rejected";
    }
  | {
      readonly state: "not-claimable";
      readonly handle: CanonicalHandle;
      readonly reservation: Reservation;
      /**
       * Which of ADR-0004 decision 7's layers refused it. `domain` is the gate
       * before anything opens; `transaction` is the re-check inside the claim
       * transaction, which only fires when the list changed between the two.
       */
      readonly caughtBy: "domain" | "transaction";
    }
  | {
      readonly state: "not-a-handle";
      readonly failure: CanonicalisationFailure;
    }
  | { readonly state: "already-registered"; readonly handle: CanonicalHandle };

export interface ClaimHandleInput {
  /** The received segment — percent-encoded, or raw emoji from a claim form. */
  readonly segment: string;
  readonly email: string;
  readonly password: string;
  readonly store: ClaimStore;
  /** The one place time is read on this path. */
  readonly clock: Clock;
  /**
   * The Reserved Handle list. **Read twice, and the second read is inside the
   * transaction**, which is the point of the parameter: a test supplies a list
   * that becomes reserved after the transaction opens and proves the second
   * read is a real one.
   */
  readonly list?: ReservedHandleList;
}

/**
 * The Claim: sign-up and hold as one atomic act.
 *
 * ADR-0004 decision 4 — *every live Account owns exactly one Handle* — is an
 * invariant about two rows in two tables, so it is true only if they are
 * written together. Everything below the {@link ClaimStore} call happens inside
 * one transaction, and any rejection rolls all of it back: a Claim that fails
 * for any reason creates **nothing**, not an Account waiting for a Handle.
 *
 * ## ADR-0004 decision 7's three layers, all three now real
 *
 * | Layer | Where |
 * | --- | --- |
 * | Domain, before any write | {@link claimableHandle}, below |
 * | Re-check inside the claim transaction | {@link reservationOf}, **inside the callback** |
 * | Database constraint | the primary key and the `CHECK`s on `handle` |
 *
 * The middle layer is the one this function exists to close, and its value is
 * entirely in *where* the call sits. A list read before the transaction opened
 * can be stale by the time the row is written; a read inside cannot, because
 * the write it guards happens before the same transaction ends. That is why the
 * call is not hoisted out as an obvious-looking optimisation, and why a test
 * reserves the Handle *after* the point a naive implementation would have
 * checked rather than merely asserting a reserved Handle is refused.
 *
 * It returns a result rather than throwing, because every rejection here is an
 * ordinary answer to a public request. A genuinely exceptional failure — a
 * rejected password, a database that is gone — still propagates.
 */
export function claimHandle(input: ClaimHandleInput): Promise<ClaimResult> {
  const list = input.list ?? RESERVED_HANDLES;

  // Layer one: the domain gate, before anything is opened or written.
  const claimability = claimableHandle(input.segment, list);
  if (!claimability.ok) {
    return Promise.resolve(
      claimability.reason === "not-a-handle"
        ? { state: "not-a-handle", failure: claimability.failure }
        : {
            state: "not-claimable",
            handle: canonicalHandleOf(input.segment),
            reservation: claimability.reservation,
            caughtBy: "domain",
          },
    );
  }

  const { handle } = claimability;
  const key = handleKeyOf(handle);
  const now = input.clock.now();
  const heldUntil = new Date(now.getTime() + HOLD_DURATION_MS);

  return input.store.runInTransaction<ClaimResult>(async (tx) => {
    // Layer two, and the reason this callback exists: the list is consulted
    // here, inside the transaction, immediately before the insert it guards.
    const reservation = reservationOf(key, list);
    if (reservation !== undefined) {
      return {
        commit: false,
        value: {
          state: "not-claimable",
          handle,
          reservation,
          caughtBy: "transaction",
        },
      };
    }

    const ownership = await tx.availabilityOf(key, now);
    if (ownership !== "available") {
      return {
        commit: false,
        value: { state: "taken", handle, because: ownership },
      };
    }

    // ADR-0004 decision 3's lazy expiry, on the only occasion it can happen:
    // someone is attempting the Handle right now. The read above answers
    // `available` both for a key with no row and for a key whose hold has
    // died, so this is where the dead row is cleared — and with it the
    // unverified Account, which is what actually frees the Handle (decision
    // 5). It is a no-op in the ordinary case.
    //
    // **Before `createAccount`, and that ordering is the rule rather than a
    // preference.** The Account being deleted may hold the very address being
    // submitted, by someone coming back to reclaim their own expired Handle. A
    // `createAccount` that ran first would read that doomed row and answer
    // `already-registered`, so they could never have it back.
    await tx.freeExpiredHold(key, now);

    const account = await tx.createAccount({
      email: input.email,
      password: input.password,
      name: handle.key,
    });
    if (!account.ok) {
      return { commit: false, value: { state: "already-registered", handle } };
    }

    const hold = await tx.holdHandle({
      key,
      userId: account.userId,
      heldUntil,
    });
    if (!hold.ok) {
      return {
        commit: false,
        value: { state: "taken", handle, because: "write-rejected" },
      };
    }

    return { commit: true, value: { state: "held", handle, heldUntil } };
  });
}
