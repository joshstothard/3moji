import type { ProfileDraft, ProfileViolation } from "@template/core";

/**
 * What the edit form is told about the last attempt.
 *
 * **Every failing state carries the draft back.** A rejected save must not cost
 * somebody the bio they just wrote, and a server action's answer is the only
 * thing that survives the round trip — the form re-renders from this, not from
 * whatever the browser happens to have left in the inputs.
 *
 * There is no success case, and that is deliberate: a saved Profile
 * revalidates and redirects to the page itself, so the only way back to the
 * form is a refusal.
 *
 * `forbidden` is what the action answers to somebody who may not edit this
 * Handle — signed out, signed in as the owner of a different Handle, or a
 * session that expired between the render and the submit — and those are **one
 * answer on purpose**: the four refusals the domain distinguishes would,
 * spelled out here, tell a stranger which of them applies to a Handle that is
 * not theirs.
 *
 * **It carries the draft too**, and that is not an oversight of the
 * one-answer rule: the likeliest way a real owner meets it is a session that
 * expired while they were writing, and losing the bio they just typed would be
 * a second punishment for it. It reveals nothing — the draft is what the
 * requester themselves posted a moment ago.
 */
export type ProfileEditFormState =
  | { readonly state: "idle" }
  | {
      readonly state: "invalid";
      readonly violations: readonly ProfileViolation[];
      readonly draft: ProfileDraft;
    }
  | { readonly state: "forbidden"; readonly draft: ProfileDraft }
  | { readonly state: "failed"; readonly draft: ProfileDraft };

/** The action the form submits to. Injected, so a test can substitute one. */
export type SaveProfile = (
  previous: ProfileEditFormState,
  formData: FormData,
) => Promise<ProfileEditFormState>;
