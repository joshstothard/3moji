import type { Clock } from "../ports/clock";
import type { ProfileStore } from "../ports/profile-store";
import {
  validateProfile,
  type ProfileDraft,
  type ProfileViolation,
} from "./validate-profile";

/**
 * What one edit did.
 *
 * `invalid` is an **ordinary answer, not an exception** — the argument
 * `validateProfile` makes and `canonicalise` made before it. It carries every
 * violation, because the caller is rendering a form and a form that reveals one
 * problem per submission is a form nobody finishes.
 */
export type ProfileEditResult =
  | { readonly state: "saved" }
  | {
      readonly state: "invalid";
      readonly violations: readonly ProfileViolation[];
    };

export interface EditProfileInput {
  /**
   * Whose Profile. **From the session**, by way of
   * {@link ./profile-authority.profileEditAuthority}, which is the only thing
   * that hands a `userId` out — never from the request body.
   */
  readonly userId: string;
  /** The Profile's editable fields, exactly as submitted. */
  readonly draft: ProfileDraft;
  readonly store: ProfileStore;
  /** The one place time is read on this path. */
  readonly clock: Clock;
}

/**
 * Save a Profile: check the limits, then write the whole thing at once.
 *
 * **Validation happens before the transaction, not inside it.** A rejected edit
 * must leave the table untouched, and the cheapest way to be sure of that is
 * for there to have been no transaction to roll back — an assertion a test can
 * make on the store's call log rather than on a result that cannot tell the
 * difference.
 *
 * **It does not decide who may edit.** That is
 * {@link ./profile-authority.profileEditAuthority}'s, and it is separate on
 * purpose: this function is handed a `userId` and writes that row, so a caller
 * who skipped the authority check would be writing the session's own row
 * whatever Handle it named. Authorisation is the transport's to enforce and the
 * authority rule's to decide; this one only asks whether the *content* may be
 * written.
 *
 * @returns `saved`, or every limit the draft broke.
 */
export async function editProfile(
  input: EditProfileInput,
): Promise<ProfileEditResult> {
  const verdict = validateProfile(input.draft);
  if (!verdict.ok) {
    return { state: "invalid", violations: verdict.violations };
  }

  const updatedAt = input.clock.now();

  return input.store.runInTransaction<ProfileEditResult>(async (tx) => {
    await tx.saveProfile({
      userId: input.userId,
      displayName: storedOrUnset(input.draft.displayName),
      bio: storedOrUnset(input.draft.bio),
      // The array's order is the order, which is what `position` will be
      // written from. Reordering is #107's and nothing here sorts.
      links: input.draft.links.map((link) => ({
        title: link.title,
        url: link.url,
      })),
      updatedAt,
    });

    return { commit: true, value: { state: "saved" } };
  });
}

/**
 * What a blank field means in the table: **`NULL`, the column's "never set"**
 * (`src/db/profile.ts`).
 *
 * The page renders a display name on `displayName !== null`, so an empty string
 * and a `NULL` are not the same page — one shows an empty heading, the other
 * shows none. Collapsing here rather than at the form is what makes that one
 * answer for every caller a write path ever grows.
 *
 * **This is a storage mapping, not a limit.** `validateProfile` sets maxima
 * only: a blank display name is permitted, and this does not quietly make it a
 * rejection.
 */
function storedOrUnset(value: string): string | null {
  return value.trim() === "" ? null : value;
}
