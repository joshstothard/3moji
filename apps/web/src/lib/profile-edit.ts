import {
  profileEditAuthority,
  toHandleKey,
  type ProfileDraft,
  type ProfileEditAuthority,
} from "@template/core";

import { getServices } from "./services";
import { readViewer } from "./session";

/**
 * Whether the person making this request may edit this Handle's Profile.
 *
 * The transport-side wiring of {@link profileEditAuthority} and nothing more —
 * the same split `lib/profile.ts` makes around `profileStateOf`. It fetches the
 * two facts the rule needs (who is signed in, and what that Account owns) and
 * hands them over; the rule itself is `packages/core`'s and is re-derived
 * nowhere.
 *
 * **Both inputs come from the server.** The viewer comes from the session
 * cookie and the owned Handle from the Account directory keyed on that
 * session's user id, so the only thing the caller contributes is *which Handle
 * is being asked about* — and that is the value the rule compares rather than
 * trusts.
 *
 * **A failed read is a refusal, not an error.** `getServices()` throws on a
 * machine without the five environment variables and the directory read can be
 * refused; either way we cannot establish that this person owns this Handle,
 * and "we could not check" must not open an edit form. `no-handle` is the
 * honest answer: nothing was found that this Account owns.
 *
 * @param segment The percent-encoded path segment, as the route received it.
 */
export async function readEditAuthority(
  segment: string,
): Promise<ProfileEditAuthority> {
  const requested = toHandleKey(segment);
  if (requested === undefined) {
    // Not a Handle at all, so it is certainly not this person's. Answered
    // rather than thrown, and deliberately not a fifth state: "this is not
    // yours" is true of a segment that is nobody's.
    return { state: "not-owner" };
  }

  const viewer = await readViewer();
  if (viewer === undefined) {
    // Asked of the rule rather than answered here, so there is one place that
    // decides what a signed-out visitor may do.
    return profileEditAuthority({
      viewer: undefined,
      owned: undefined,
      requested,
    });
  }

  try {
    const { accounts } = getServices();
    const owned = await accounts.handleOf(viewer.userId);
    return profileEditAuthority({ viewer, owned, requested });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "edit_authority_read_failed",
        message: error instanceof Error ? error.message : "unknown error",
      }),
    );
    return { state: "no-handle" };
  }
}

/**
 * The owner's Profile as a draft the form can open on, or `undefined` if it
 * could not be read.
 *
 * **`undefined` is not an empty Profile, and the difference is destructive.**
 * A Profile that has never been edited is an empty draft — blanks are exactly
 * what its owner should see. A Profile that *could not be read* is unknown, and
 * rendering blanks for it invites the owner to save those blanks over content
 * that is still there. The write replaces the whole Link list, so that single
 * confusion is the one failure on this path that destroys somebody's Profile
 * rather than merely frustrating them; the caller renders a notice instead.
 *
 * It reads `ProfileRepository` directly rather than going through
 * `lib/profile.ts`, because that module composes the Profile with an
 * *availability* answer for a visitor, and the caller here has already
 * established something stronger: that this person owns this claimed Handle.
 *
 * @param segment The percent-encoded segment the authority check just allowed.
 */
export async function readEditableDraft(
  segment: string,
): Promise<ProfileDraft | undefined> {
  const key = toHandleKey(segment);
  if (key === undefined) return undefined;

  try {
    const { profiles } = getServices();
    const profile = await profiles.profileOf(key);
    if (profile === undefined) {
      // Claimed and never edited: an empty draft, which is the honest opening
      // state of a form for somebody who has added nothing yet.
      return { displayName: "", bio: "", links: [] };
    }
    return {
      // `null` is the column's "never set"; an input cannot hold one.
      displayName: profile.displayName ?? "",
      bio: profile.bio ?? "",
      links: profile.links.map((link) => ({
        title: link.title,
        url: link.url,
      })),
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "editable_profile_read_failed",
        message: error instanceof Error ? error.message : "unknown error",
      }),
    );
    return undefined;
  }
}
