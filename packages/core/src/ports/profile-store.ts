import type { TransactionOutcome } from "./claim-store";

/** One Link as the owner submitted it, on its way to the table. */
export interface ProfileLinkToWrite {
  readonly title: string;
  readonly url: string;
}

/**
 * A Profile as one edit leaves it — **the whole Profile, never a patch**.
 *
 * `data-model.md` § Profile makes the Link list an ordered whole: the array's
 * order *is* `position`, so a write that touched one row would have to reason
 * about the others anyway. Carrying the finished list removes that reasoning
 * from every caller and makes the adapter's job "make the table say this".
 *
 * `displayName` and `bio` are `string | null` where {@link
 * ../profile/validate-profile.ProfileDraft}'s are `string`, and the difference
 * is the point: `NULL` is the column's "never set" (`src/db/profile.ts`) and
 * only {@link ../profile/edit-profile.editProfile} decides when a submitted
 * blank becomes one. A validator counts characters; a writer stores meaning.
 */
export interface ProfileToWrite {
  /** The owning Account — `profile.user_id`, which is the row's identity. */
  readonly userId: string;
  readonly displayName: string | null;
  readonly bio: string | null;
  /** In the order the owner set. Written to `position` 0, 1, 2 … */
  readonly links: readonly ProfileLinkToWrite[];
  /**
   * When the edit happened, from the injected `Clock`. Never `now()` in SQL —
   * `profile.updated_at` is a value the domain reasons about, and a SQL default
   * would put it where no test can move time.
   */
  readonly updatedAt: Date;
}

/**
 * The writes one edit performs — **valid only inside its transaction**, exactly
 * as {@link ClaimTransaction} and {@link ../ports/release-store
 * .ReleaseTransaction} are.
 *
 * One method, because one edit is one act. Replacing a Profile means writing
 * the row *and* rewriting its whole Link list, and a port offering those
 * separately would let a caller delete ten Links and fail before inserting the
 * replacements — a Profile emptied by a crash rather than by its owner.
 */
export interface ProfileTransaction {
  /**
   * Make the Profile say this: upsert the row, then replace the Link list
   * entire.
   */
  saveProfile(input: ProfileToWrite): Promise<void>;
}

/**
 * One transaction, opened around one edit.
 *
 * **A separate port from {@link ../ports/profile-repository
 * .ProfileRepository}**, which that port's own comment asks for: it is
 * read-only so that a page read cannot write, and these writes exist only on
 * the object this hands its callback. Nothing can rewrite a Link list without a
 * transaction, because there is nowhere else to reach the verb from.
 */
export interface ProfileStore {
  runInTransaction<T>(
    work: (tx: ProfileTransaction) => Promise<TransactionOutcome<T>>,
  ): Promise<T>;
}
