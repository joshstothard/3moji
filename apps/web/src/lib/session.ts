import { headers } from "next/headers";
import type { ProfileEditor } from "@template/core";

import { getServices } from "./services";
import { logFailure } from "./log-error";

/**
 * Who is signed in, according to **the session cookie and nothing else**.
 *
 * This is the only place an identity enters the application, and that is the
 * whole point: every authorisation decision downstream is made about the value
 * this returns, so a Handle or a user id arriving in a request body has nowhere
 * to be believed. `profileEditAuthority` takes a {@link ProfileEditor}, and
 * this function is the only thing that constructs one.
 *
 * **It answers `undefined` rather than throwing.** `getServices()` throws
 * unless all five environment variables are set, and Better Auth's session
 * lookup is a database read that can be refused — and the honest answer to
 * "who is this?" when we cannot tell is *nobody*, which is the answer that
 * grants nothing. Failing open here would be an authorisation bypass; failing
 * closed is a signed-in owner being asked to sign in again, which is the
 * failure worth having. The same shape `readProfile`'s catch takes, for a
 * different reason.
 */
export async function readViewer(): Promise<ProfileEditor | undefined> {
  try {
    const { auth } = getServices();
    const session = await auth.api.getSession({ headers: await headers() });
    if (session === null) return undefined;
    return { userId: session.user.id };
  } catch (error) {
    logFailure("session_read_failed", error);
    return undefined;
  }
}
