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
 * which is about links. Narrow ports rather than one store, because they have
 * different lifetimes.
 *
 * **This comment used to say "only this one will grow a Profile", and that
 * turned out to be wrong** (#102). The Profile went to its own port,
 * {@link ../ports/profile-repository.ProfileRepository}, because it is read
 * from the opposite direction: this port answers *about an Account* and is
 * reached from a session, while a Profile is read by a visitor who has typed a
 * Handle and has no Account at all. Adding `profileOf` here would have forced
 * that visitor to resolve a `userId` first, for nothing.
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
