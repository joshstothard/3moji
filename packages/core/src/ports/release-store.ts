import type { HandleKey } from "../db/handle-key";
import type { TransactionOutcome } from "./claim-store";

/**
 * The tombstone one Release leaves: **the canonical key and the time, and
 * nothing else**.
 *
 * [ADR-0009](../../../../docs/adr/0009-release-leaves-a-tombstone-and-the-cooldown-is-dropped-for-the-mvp.md)
 * decision 3 is a rule about this type as much as about the table. Release *is*
 * account deletion, and a tombstone naming its former owner would make
 * "Releasing takes the Profile and its Links with it" true in letter and false
 * in substance. The canonical key was a public URL already, so on its own it
 * identifies nobody.
 */
export interface ReleasedHandle {
  readonly key: HandleKey;
  /**
   * When the Handle went back into the pool, from the injected `Clock`. Never
   * `now()` in SQL: this is the timestamp a cooldown would one day be dated
   * from, and a SQL default would put it where no test can move time.
   */
  readonly releasedAt: Date;
}

/**
 * The reads and writes one Release performs — **valid only inside its
 * transaction**, exactly as {@link ClaimTransaction} is.
 *
 * It is a **separate port from the Claim's**, not three more methods on it.
 * `freeExpiredHold` belongs to the claim path and is reachable only from
 * inside a Claim; `deleteAccount` is not, and putting it on `ClaimTransaction`
 * would hand the claim path a verb for deleting somebody's Account. Interface
 * Segregation, in `docs/development/engineering-standards.md`, is the rule
 * being followed rather than a preference.
 */
export interface ReleaseTransaction {
  /**
   * The Handle this Account owns, read **inside** the transaction and before
   * anything is deleted — `handle.user_id` cascades, so after the delete there
   * is nothing left to read the key from.
   */
  handleOf(userId: string): Promise<HandleKey | undefined>;
  /** Write the tombstone. Decision 2: in the same transaction as the deletion. */
  recordRelease(tombstone: ReleasedHandle): Promise<void>;
  /**
   * Delete the Account, which is what Release *is* (ADR-0004 decision 5).
   *
   * **It deletes a `user` row, not a `handle` row** — the same shape
   * `freeExpiredHold` already takes. `handle.user_id` references `user.id`
   * `ON DELETE CASCADE`, so the Handle, the sessions, the credential rows and
   * the verification dispatches all go with the Account, and Phase 4's Profile
   * and Links will cascade from the same row.
   */
  deleteAccount(userId: string): Promise<void>;
}

/**
 * One transaction, opened around the whole Release.
 *
 * The tombstone and the deletion are one act: a tombstone for an Account that
 * still exists is a lie, and a deletion with no tombstone loses the one fact
 * that cannot be recreated later (ADR-0009's Context — time cannot be
 * backfilled). Making it a unit of work rather than a pair of write methods
 * keeps that structural, the same argument {@link ClaimStore} makes.
 */
export interface ReleaseStore {
  runInTransaction<T>(
    work: (tx: ReleaseTransaction) => Promise<TransactionOutcome<T>>,
  ): Promise<T>;
}
