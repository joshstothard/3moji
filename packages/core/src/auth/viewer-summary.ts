import { canonicalise } from "../handle/canonicalise";
import type { OwnedHandle } from "../ports/account-directory";
import {
  profileEditAuthority,
  type ProfileEditor,
} from "../profile/profile-authority";

/**
 * What the signed-in indicator may know about the person looking at it
 * ([#193](https://github.com/joshstothard/3moji/issues/193)).
 *
 * **Only what the navbar renders, and nothing that identifies the Account.**
 * No user id, no email, no hold expiry: this value is sent to the browser, and
 * an answer that carried more than the links it draws would be a small API for
 * reading one's own Account that nothing needs.
 *
 * - `signed-out` — no session. The indicator offers a sign-in link.
 * - `signed-in` — a session, and no Handle worth linking to: none found, a
 *   hold that is not yet final, or an Account read that failed. Still a
 *   signed-in state, because sign-out (#194) hangs off it.
 * - `owner` — a claimed Handle, the only state that links to a Profile and its
 *   edit page.
 */
export type ViewerSummary =
  | { readonly state: "signed-out" }
  | { readonly state: "signed-in" }
  | {
      readonly state: "owner";
      /** The Handle's three emoji, canonical. */
      readonly key: string;
      /** The percent-encoded path segment, as every link to a Handle uses. */
      readonly encoded: string;
    };

export interface ViewerSummaryInput {
  /** Who the session says is looking — `lib/session.ts`, and nothing else. */
  readonly viewer: ProfileEditor | undefined;
  /** What the Account directory says that viewer holds or owns. */
  readonly owned: OwnedHandle | undefined;
}

/**
 * Decide what the signed-in indicator shows.
 *
 * **Pure, and it re-derives nothing.** Whether the viewer may be linked to a
 * Handle's Profile and edit page is exactly whether they may edit it, so the
 * answer is `profileEditAuthority`'s, asked about the Handle the Account owns:
 * `allowed` is the only verdict that links. The session decides first there,
 * so nothing about a Handle reaches somebody the session does not name, and
 * `claimed_at` decides ownership there (ADR-0004 decision 3), so a hold is
 * never linked as though it were a Profile.
 *
 * This decides **links, never permission**. The edit page and
 * `saveProfileAction` each enforce `profileEditAuthority` themselves, so a
 * wrong answer here can show a link that 404s, and cannot open a write.
 */
export function viewerSummary(input: ViewerSummaryInput): ViewerSummary {
  const { viewer, owned } = input;

  if (viewer === undefined) return { state: "signed-out" };
  if (owned === undefined) return { state: "signed-in" };

  const authority = profileEditAuthority({
    viewer,
    owned,
    requested: owned.key,
  });
  if (authority.state !== "allowed") return { state: "signed-in" };

  // The key came out of the `handle` table, so it is canonical already; this
  // derives the encoded path the way every other link to a Handle is derived,
  // rather than calling `encodeURIComponent` a second way.
  const handle = canonicalise(owned.key);
  if (!handle.ok) return { state: "signed-in" };

  return { state: "owner", key: owned.key, encoded: handle.encoded };
}
