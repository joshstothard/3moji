import type { HandleKey } from "../db/handle-key";
import type { OwnedHandle } from "../ports/account-directory";

/** Who is asking. `undefined` at this field is "nobody is signed in". */
export interface ProfileEditor {
  /** From the **session**, never from the request body. */
  readonly userId: string;
}

/**
 * Whether this person may edit this Handle's Profile, and if so whose row.
 *
 * **`allowed` carries the `userId`, and that is not a convenience.** It is the
 * only value on this union a caller may write with, so the write key comes out
 * of the authorisation verdict rather than out of the request — a transport
 * adapter cannot reach for a Handle or an id the client sent without ignoring
 * the answer it was given.
 *
 * The four refusals are **different answers**, the argument `canonicalise` and
 * `validateProfile` both make: "you are not signed in" and "your Claim is not
 * finished" want different pages. What a transport does with them is its own
 * decision, and it may well collapse several into one response.
 */
export type ProfileEditAuthority =
  | { readonly state: "allowed"; readonly userId: string }
  | { readonly state: "signed-out" }
  /** Signed in, but no Handle is held or owned under this Account. */
  | { readonly state: "no-handle" }
  /** Held, not claimed. A hold is not ownership — ADR-0004. */
  | { readonly state: "not-claimed" }
  /** Signed in, owns a Handle, and it is not this one. */
  | { readonly state: "not-owner" };

export interface ProfileEditAuthorityInput {
  readonly viewer: ProfileEditor | undefined;
  /** What the Account directory says this viewer holds or owns. */
  readonly owned: OwnedHandle | undefined;
  /** The Handle whose Profile is being asked for. */
  readonly requested: HandleKey;
}

/**
 * The Profile edit rule: **the owner of the claimed Handle, and nobody else.**
 *
 * Pure, and separate from the transport that will enforce it, for the reason
 * `docs/development/quality-strategy.md` gives about rules generally — but
 * this one earns it twice over, because an authorisation rule embedded in a
 * server action is a rule that can only be tested by driving the framework, and
 * the case that matters is not the obvious one. A signed-out visitor is refused
 * by the first guard anybody writes. **A signed-in visitor who owns a different
 * Handle is refused only by this comparison**, and nothing else in the system
 * makes it: `profile.user_id` is the primary key, so a write derived from the
 * session lands on the writer's own row whatever Handle they name — which is
 * silent corruption of their own Profile rather than the refusal the person
 * asking deserves.
 *
 * **Standing first, then the Handle.** The refusals are ordered so the answer
 * is about the viewer before it is about the Handle they asked for: somebody
 * whose Claim is unfinished is told so even when they also asked for the wrong
 * Handle, because that is the fact they can act on.
 */
export function profileEditAuthority(
  input: ProfileEditAuthorityInput,
): ProfileEditAuthority {
  const { viewer, owned, requested } = input;

  if (viewer === undefined) return { state: "signed-out" };
  if (owned === undefined) return { state: "no-handle" };
  // `claimed_at` is what ownership means (ADR-0004 decision 3), and
  // `profileStateOf` will not publish a Profile for anything but `claimed` —
  // so a Profile written from a hold is a row no reader can ever see.
  if (owned.claimedAt === null) return { state: "not-claimed" };
  if (owned.key !== requested) return { state: "not-owner" };

  return { state: "allowed", userId: viewer.userId };
}
