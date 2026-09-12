/** One verification link that went out. */
export interface VerificationDispatch {
  readonly userId: string;
  /** SHA-256 of the token, hex-encoded. Never the token. */
  readonly tokenHash: string;
  readonly sentAt: Date;
}

/**
 * What the domain needs from the `verification_dispatch` table.
 *
 * Two questions, and they are the two the feature rests on: *how often has this
 * Account been sent a link* (the rate limit) and *is the link in front of me
 * the newest one* (invalidation). Better Auth answers neither, because its
 * verification token is a signed JWT it does not store.
 *
 * `record` is the only write, and it is called from exactly one place — the
 * `sendVerificationEmail` hook — so "every token we issue is recorded" holds
 * structurally rather than by convention. A caller that could issue a link
 * without recording it would silently reopen an invalidated one.
 */
export interface VerificationDispatchStore {
  record(dispatch: VerificationDispatch): Promise<void>;
  /**
   * This Account's dispatches at or after `since`, for the rate-limit window.
   * `since` is a parameter rather than a `Clock` the adapter owns, for the same
   * reason `HandleRepository.availabilityOf` takes `now`: time is read once, in
   * the use case, so a fake cannot disagree with it.
   */
  since(userId: string, since: Date): Promise<readonly VerificationDispatch[]>;
  /** The newest link issued to this Account, which is the only valid one. */
  newestFor(userId: string): Promise<VerificationDispatch | undefined>;
  /**
   * Whose link this is. Returns the newest match, because the fingerprint is
   * deliberately not unique — see the column's comment.
   */
  findByTokenHash(tokenHash: string): Promise<VerificationDispatch | undefined>;
}
