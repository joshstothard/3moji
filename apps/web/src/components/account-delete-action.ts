"use server";

import {
  canonicalise,
  releaseHandle,
  type ReleaseResult,
} from "@template/core";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import en from "../../../../packages/shared/messages/en.json";
import { atBoundary, type RecordOutcome } from "../lib/boundary-log";
import { logFailure } from "../lib/log-error";
import { getServices } from "../lib/services";
import { readViewer } from "../lib/session";

/**
 * Delete the signed-in person's Account, giving up their Handle
 * ([#195](https://github.com/joshstothard/3moji/issues/195)).
 *
 * A thin transport adapter over {@link releaseHandle}, which owns what a
 * Release is: the tombstone and the account deletion in one transaction
 * (ADR-0004 decision 5, ADR-0009). What is decided here is only what a
 * transport may decide — whose Account, whether they confirmed, and where the
 * browser goes next.
 *
 * **Whose Account comes from the session and nowhere else.** A server action
 * is a public HTTP endpoint that can be posted to directly with any fields, so
 * nothing is read from the form but the confirmation word. There is no field
 * by which a request can name somebody else's Account.
 *
 * **The confirmation is enforced here, not only on the page.** The page's
 * field is `required`, which a direct POST ignores. The word is compared with
 * `AccountPage.confirmWord` in `en.json` — the same key the page shows — so a
 * second locale must keep the word it shows and the word it checks in step.
 * Case and surrounding spaces are forgiven, because a phone keyboard
 * capitalises the first letter; anything else is refused.
 */
export async function deleteAccountAction(formData: FormData): Promise<void> {
  return atBoundary("account.delete", (record) =>
    deleteAccount(formData, record),
  );
}

async function deleteAccount(
  formData: FormData,
  record: RecordOutcome,
): Promise<void> {
  const viewer = await readViewer();
  if (viewer === undefined) {
    record("rejected");
    redirect("/sign-in");
  }

  if (!confirmed(formData)) {
    record("rejected");
    redirect("/account?error=confirm");
  }

  let result: ReleaseResult;
  try {
    const { releases, clock } = getServices();
    result = await releaseHandle({
      userId: viewer.userId,
      store: releases,
      clock,
    });
  } catch (error) {
    // The transaction rolled back, so nothing was deleted and the copy can say
    // so. Outside this catch for the redirect, which works by throwing.
    logFailure("account_delete_failed", error);
    record("failed");
    redirect("/account?error=failed");
  }

  if (result.state === "no-handle") {
    // A live session for an Account that owns no Handle: ADR-0004 decision 4
    // leaves only a Release that has already happened. Nothing was deleted.
    record("rejected");
    redirect("/account?error=failed");
  }

  /*
   * **Revalidate, then redirect** — `docs/development/engineering-standards.md`
   * § Data Fetching. Built from the encoded segment, never the raw key: a raw
   * emoji in a path fails Node's header validation. A key read back from the
   * `handle` table is canonical, so it always canonicalises.
   */
  const handle = canonicalise(result.key);
  if (handle.ok) revalidatePath(`/${handle.encoded}`);

  await clearSessionCookie();

  record("redirected");
  redirect("/");
}

/** Whether the posted confirmation is the word the page asked for. */
function confirmed(formData: FormData): boolean {
  const value = formData.get("confirmation");
  return (
    typeof value === "string" &&
    value.trim().toLowerCase() === en.AccountPage.confirmWord
  );
}

/**
 * Clears this browser's session cookie.
 *
 * **The session is already gone** — `session.user_id` cascades from the `user`
 * row the Release deleted — so the cookie names nothing and any request
 * carrying it reads as signed out. This removes the dead cookie as well, so the
 * browser does not keep sending it. Better Auth's `signOut` deletes the cookie
 * whether or not it finds a session row, and `nextCookies()` writes that onto
 * this action's response.
 *
 * A failure here is logged and swallowed: the Account is deleted and the answer
 * must say so, not report a failure for a deletion that committed.
 */
async function clearSessionCookie(): Promise<void> {
  try {
    const { auth } = getServices();
    await auth.api.signOut({ headers: await headers() });
  } catch (error) {
    logFailure("account_delete_sign_out_failed", error);
  }
}
