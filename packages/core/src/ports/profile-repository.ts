import type { HandleKey } from "../db/handle-key";

/** One link on a Profile, as a reader sees it. */
export interface ProfileLink {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  /**
   * Where this Link sits in the owner's list. Carried out of the adapter
   * rather than left implicit in the array's order, so a caller that
   * re-sorts — or a test that means to assert the order — has the value the
   * order was built from rather than a convention it must trust.
   */
  readonly position: number;
}

/** A Profile and its Links, in the order the owner set. */
export interface Profile {
  /** `null` is "never set". See `src/db/profile.ts`. */
  readonly displayName: string | null;
  readonly bio: string | null;
  /** Ascending by {@link ProfileLink.position}, always. */
  readonly links: readonly ProfileLink[];
  readonly updatedAt: Date;
}

/**
 * The Profile behind one canonical Handle.
 *
 * **Read-only, like {@link ../ports/handle-repository.HandleRepository} and
 * {@link ../ports/account-directory.AccountDirectory}, and for the same
 * reason.** Editing a Profile rewrites the row and its whole Link list as one
 * act (#106), so it belongs on a unit of work the way the Claim's writes belong
 * on `ClaimStore`. A port that could do both would let a caller write a Link
 * without a transaction and leave a half-reordered list behind.
 *
 * **Keyed on the Handle, not on the Account** — which is the opposite direction
 * from `AccountDirectory.handleOf(userId)`, and deliberate. The caller is a
 * visitor who has typed a Handle and has no Account; making them resolve a
 * `userId` first would be a second round trip to reach the same row the join
 * already reaches. The row itself is keyed on the Account (`src/db/profile.ts`);
 * only this lookup is keyed on the Handle.
 *
 * **It does not say whether the Handle is claimed, and must not.** `undefined`
 * here means "no Profile row", which an unclaimed key, a held key and a claimed
 * but unedited key all produce. Deciding between those needs an injected `now`
 * and the hold-expiry rule, which live in `ownershipOf` — a second encoding of
 * that rule inside this join is exactly what `src/db/handle.ts` warns against.
 * Compose the two with
 * {@link ../profile/profile-state.profileStateOf} instead.
 */
export interface ProfileRepository {
  profileOf(key: HandleKey): Promise<Profile | undefined>;
}
