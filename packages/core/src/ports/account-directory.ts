import type { HandleKey } from "../db/handle-key";

/** The Account facts the verification flow needs. */
export interface AccountRecord {
  readonly userId: string;
  readonly email: string;
  /** The Claim gate: a Claim is final only once this is true. */
  readonly emailVerified: boolean;
}

/** The Handle an Account holds or owns. */
export interface OwnedHandle {
  readonly key: HandleKey;
  readonly heldUntil: Date;
  /** `null` is what "still held" means. */
  readonly claimedAt: Date | null;
}

/**
 * Reads about one Account: who they are, and which Handle is theirs.
 *
 * Separate from {@link ../ports/handle-repository.HandleRepository}, which
 * answers about a *key* rather than about an Account, and separate from
 * {@link ../ports/verification-dispatch-store.VerificationDispatchStore},
 * which is about links. Three narrow ports rather than one store, because the
 * three have different lifetimes and only this one will grow a Profile.
 *
 * **Read-only, like `HandleRepository` and for the same reason.** Everything
 * that writes on this path — the hold, its finalisation, the Account's deletion
 * — happens inside a transaction, and a port that could do both would let a
 * caller write without one.
 */
export interface AccountDirectory {
  byEmail(email: string): Promise<AccountRecord | undefined>;
  /** The Handle owned or held by this Account, if it has one. */
  handleOf(userId: string): Promise<OwnedHandle | undefined>;
}
