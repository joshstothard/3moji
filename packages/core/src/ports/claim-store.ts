import type { HandleKey } from "../db/handle-key";
import type { HandleOwnership } from "../handle/handle-ownership";

/** The Account a Claim creates. */
export interface AccountToCreate {
  /**
   * **Already normalised** — trimmed and lowercased, by the Claim itself
   * (#163). That is the form Better Auth stores, so an adapter may compare it
   * to `user.email` exactly, and use the column's unique index to do it.
   */
  readonly email: string;
  readonly password: string;
  /**
   * Better Auth's `user.name` is not null and sign-up has none to collect — the
   * claim form asks for an email, a password and three emoji (#15). The claim
   * path passes the canonical key, because the Handle *is* the identity at this
   * point; a display name is a Profile field and belongs to Phase 4.
   */
  readonly name: string;
}

/**
 * Whether the Account was created.
 *
 * `email-taken` is a **fact about the database, not a response to the user**.
 * Better Auth returns a synthetic success for an already-registered address to
 * prevent account enumeration (#15), and the transport must keep that promise
 * by rendering the same hold screen. The domain still has to know, because it
 * decides whether anything is written.
 */
export type AccountCreated =
  | { readonly ok: true; readonly userId: string }
  | { readonly ok: false; readonly reason: "email-taken" };

/** The hold a Claim writes. */
export interface HoldToWrite {
  readonly key: HandleKey;
  readonly userId: string;
  /**
   * When the hold dies. Supplied from the injected `Clock` by the use case
   * above this port — never `now() + interval '24 hours'`, which would put
   * ADR-0004 decision 3's rule where no test can move time.
   */
  readonly heldUntil: Date;
}

/**
 * Whether the hold was written.
 *
 * `key-taken` is the primary key having the last word. Since
 * [#83](https://github.com/joshstothard/3moji/issues/83) an expired hold is
 * freed earlier in the same transaction, so this now means a **genuine race**:
 * another Claim committed this key between the availability read and the
 * insert.
 */
export type HoldWritten =
  { readonly ok: true } | { readonly ok: false; readonly reason: "key-taken" };

/**
 * Whether an expired hold was found and freed.
 *
 * `freed: false` is the ordinary case — there was no row, or the row is a live
 * hold or a finished Claim. It is not an error and carries no reason, because
 * the caller has already read ownership and has nothing to decide on it; the
 * flag exists so a test can tell "looked and found nothing" from "did not
 * look".
 */
export interface ExpiredHoldFreed {
  readonly freed: boolean;
}

/**
 * The reads and writes a Claim performs — **valid only inside its transaction**.
 *
 * This object exists only as the argument handed to
 * {@link ClaimStore.runInTransaction}'s callback, and that is the whole design:
 * `HandleRepository` was kept read-only so a caller could not write without a
 * transaction, and this port keeps that property structural rather than asked
 * for. There is no way to reach `holdHandle` except from inside one.
 */
export interface ClaimTransaction {
  /**
   * What the table says about this key, read **inside** the transaction. The
   * same interpretation `HandleRepository.availabilityOf` gives, including an
   * expired hold reading as `available`.
   */
  availabilityOf(key: HandleKey, now: Date): Promise<HandleOwnership>;
  /**
   * Free an expired hold on this key, if that is what the row is — the **write
   * side** of ADR-0004 decision 3's lazy expiry.
   *
   * Expiry is evaluated when someone next attempts the Handle and there is no
   * sweep, so this is reachable only from inside a Claim's transaction, which
   * is the whole reason it lives on this object rather than on a repository.
   *
   * **Freeing the Handle is deleting the unverified Account** (decision 5's
   * last sentence): `handle.user_id` cascades from `user`, so the Account is
   * what a delete has to name, and the Handle row goes with it.
   *
   * The row it may free is exactly the one {@link availabilityOf} reads as
   * `available` while still being there: `claimed_at IS NULL AND held_until <=
   * now`. **`claimed_at IS NULL` is what "still held" means**, so a verified
   * Account is never freed whatever its `held_until` says — and the condition
   * is restated here rather than inferred from the read, because an adapter
   * that trusted the caller's verdict would delete a verified Account the
   * moment that verdict was wrong.
   */
  freeExpiredHold(key: HandleKey, now: Date): Promise<ExpiredHoldFreed>;
  createAccount(input: AccountToCreate): Promise<AccountCreated>;
  holdHandle(input: HoldToWrite): Promise<HoldWritten>;
}

/**
 * What the work inside a transaction decided, and whether it may commit.
 *
 * A rejected Claim is an **ordinary answer**, not an exception — the same
 * argument `canonicalise` and `claimableHandle` make — but it must still roll
 * the transaction back. Returning the verdict beside the commit decision keeps
 * exceptions out of the domain's control flow while leaving the adapter in
 * charge of the rollback.
 */
export interface TransactionOutcome<T> {
  /** `false` rolls the transaction back; the value is still returned. */
  readonly commit: boolean;
  readonly value: T;
}

/**
 * One transaction, opened around the whole Claim.
 *
 * ADR-0004 decision 4 makes account creation and the hold **one atomic act**:
 * neither may exist without the other. That is what this port is for, and why
 * it is a unit of work rather than a pair of write methods — two calls the
 * caller is trusted to wrap would be the invariant stated as a convention.
 */
export interface ClaimStore {
  runInTransaction<T>(
    work: (tx: ClaimTransaction) => Promise<TransactionOutcome<T>>,
  ): Promise<T>;
}
