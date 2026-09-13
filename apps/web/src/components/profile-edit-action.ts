"use server";

import { canonicalise, editProfile, type ProfileDraft } from "@template/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  atBoundary,
  type BoundaryOutcome,
  type RecordOutcome,
} from "../lib/boundary-log";
import { readEditAuthority } from "../lib/profile-edit";
import { getServices } from "../lib/services";
import { logFailure } from "../lib/log-error";
import type { ProfileEditFormState } from "./profile-edit-state";

/**
 * Save a Profile.
 *
 * A thin transport adapter over {@link editProfile}, which owns the limits, and
 * over `profileEditAuthority`, which owns who may write. What is decided here
 * is only what a transport may decide: how a posted form becomes a draft, and
 * what a refusal looks like over HTTP.
 *
 * **The authorisation is this action's own, not the page's.** A server action
 * is a public HTTP endpoint — it can be posted to directly, with any Handle, by
 * anyone holding a session cookie — so "the form was never rendered for them"
 * protects nothing. The page's guard and this one are independent layers, and
 * this is the one an attacker actually reaches.
 *
 * **The `userId` written comes out of the authority verdict.** Nothing here
 * reads an id from the form, so there is no path by which a posted field
 * becomes a write key; the Handle *is* read from the form, and that is exactly
 * what the verdict compares against the session's own.
 *
 * Every field is read as `unknown` for the reason `submitClaimAction` gives:
 * whatever a client posts arrives here.
 */
export async function saveProfileAction(
  _previous: ProfileEditFormState,
  formData: FormData,
): Promise<ProfileEditFormState> {
  return atBoundary("profile.save", (record) => saveProfile(formData, record), {
    outcomeOf: outcomeOfSave,
  });
}

/**
 * The boundary outcome of an answer that returned to the form (#156): a
 * refusal of who is asking or of what they posted is `rejected`, and a write
 * that threw is `failed`. A saved Profile records `redirected`.
 */
function outcomeOfSave(result: ProfileEditFormState): BoundaryOutcome {
  switch (result.state) {
    case "idle":
      return "ok";
    case "invalid":
    case "forbidden":
      return "rejected";
    case "failed":
      return "failed";
  }
}

async function saveProfile(
  formData: FormData,
  record: RecordOutcome,
): Promise<ProfileEditFormState> {
  // Parsed before anything is decided, so that **every** answer can carry it
  // back. A refusal is most often a session that expired mid-edit, and losing
  // what was typed would be a second punishment for it; the draft is what the
  // requester posted a moment ago, so returning it reveals nothing.
  const draft = draftFrom(formData);
  const forbidden: ProfileEditFormState = { state: "forbidden", draft };

  const segment = formData.get("handle");
  if (typeof segment !== "string") return forbidden;

  const handle = canonicalise(segment);
  // A segment that is not a Handle cannot be anybody's, so there is nothing to
  // distinguish from the refusal below.
  if (!handle.ok) return forbidden;

  const authority = await readEditAuthority(handle.encoded);
  if (authority.state !== "allowed") return forbidden;

  try {
    const { profileEdits, clock } = getServices();
    const result = await editProfile({
      userId: authority.userId,
      draft,
      store: profileEdits,
      clock,
    });

    if (result.state === "invalid") {
      // The draft goes back with the violations: a rejected save must not cost
      // somebody what they typed.
      return { state: "invalid", violations: result.violations, draft };
    }
  } catch (error) {
    logFailure("profile_save_failed", error);
    return { state: "failed", draft };
  }

  /*
   * **Revalidate, then redirect — in that order, and the order is the
   * behaviour.** `docs/development/engineering-standards.md` § Frontend records
   * why: without busting the cache first, Next serves the cached page and the
   * edit that just committed appears not to have taken effect. Redirecting
   * first would leave the call unreachable, because `redirect` signals by
   * throwing.
   *
   * The path is built from `handle.encoded`, never from the raw key: a raw
   * emoji in a `Location` header fails Node's header validation with
   * `ERR_INVALID_CHAR` and serves a 500.
   */
  revalidatePath(`/${handle.encoded}`);

  // Outside the try, for the reason `submitClaimAction` gives: `redirect` works
  // by throwing, and catching it here would report a saved Profile as a
  // failure.
  record("redirected");
  redirect(`/${handle.encoded}`);
}

/**
 * The posted form as a {@link ProfileDraft}.
 *
 * **Link rows are indexed fields, not parallel lists.** `link-0-title` and
 * `link-0-url` keep a row's two halves together whatever the client posts;
 * zipping two `getAll` arrays would pair the wrong title with the wrong URL the
 * moment one of them is missing, and would tempt an index assertion the lint
 * rules forbid besides.
 *
 * **No cap on how many rows are read.** Ten is the limit, and reading only ten
 * would silently discard an eleventh instead of letting `validateProfile` say
 * `too-many` — which is the message the owner needs.
 *
 * **A row blank on both halves is a removed row.** Clearing both fields is how
 * the form removes a Link without JavaScript, and an empty row submitted as a
 * Link would be rejected as a malformed URL for a Link the owner does not
 * think they have.
 */
function draftFrom(formData: FormData): ProfileDraft {
  return {
    displayName: textAt(formData, "displayName"),
    bio: textAt(formData, "bio"),
    links: linkIndexes(formData)
      .map((index) => ({
        title: textAt(formData, `link-${String(index)}-title`),
        url: textAt(formData, `link-${String(index)}-url`),
      }))
      .filter((link) => link.title.trim() !== "" || link.url.trim() !== ""),
  };
}

/** A field's value, or `""` for anything that is not a posted string. */
function textAt(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * The row numbers present in the form, ascending — **which is the order the
 * Links are saved in**, since `position` is the array index.
 *
 * Sorted numerically rather than lexically: `"10"` sorts before `"2"` as a
 * string, which would put a tenth Link second.
 */
function linkIndexes(formData: FormData): readonly number[] {
  const indexes = new Set<number>();
  for (const key of formData.keys()) {
    const match = /^link-(\d+)-(?:title|url)$/.exec(key);
    if (match?.[1] !== undefined) indexes.add(Number(match[1]));
  }
  return [...indexes].sort((left, right) => left - right);
}
