"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { atBoundary } from "../lib/boundary-log";
import { getServices } from "../lib/services";
import { logFailure } from "../lib/log-error";

/**
 * Sign out ([#194](https://github.com/joshstothard/3moji/issues/194)).
 *
 * A thin transport adapter: Better Auth's `signOut` deletes the session row
 * behind the request's cookie and expires the cookie, and `nextCookies()` —
 * passed to `createAuth` in `lib/services.ts` — writes that expiry onto this
 * action's response. It is called **server-side with the request's own
 * headers**, so the only session it can end is the one the request carries.
 *
 * **A form action, so a POST and never a GET.** Next.js runs a server action
 * only for a POST, so no link, image or redirect on a third-party page can sign
 * anybody out. A cross-site POST is refused twice over: Better Auth's cookie is
 * `SameSite=Lax`, so the browser does not send it, and Next.js aborts an action
 * whose `Origin` does not match the host. `e2e/sign-out.spec.ts` proves both
 * the GET and the cross-site POST do nothing.
 *
 * **It takes no arguments.** A form hands its action the form's data; this one
 * reads none of it, so no field can choose where the person lands.
 *
 * **Every answer lands on `/`**, where the navbar's indicator asks
 * `GET /api/viewer` who is looking. A failure — services that cannot be built,
 * a sign-out that throws — is logged through `logFailure` as `sign_out_failed`
 * and still lands there, and the indicator then shows what is true: still
 * signed in. Nothing renders from the session, so there is no cached page to
 * `revalidatePath`.
 *
 * **Better Auth reports success even when the row delete fails**: it logs the
 * database error, still expires the cookie, and returns. That browser is signed
 * out either way; see `docs/architecture/auth.md` § Signing out.
 */
export async function signOutFormAction(): Promise<void> {
  await atBoundary("sign-out.form", async (record) => {
    try {
      const { auth } = getServices();
      await auth.api.signOut({ headers: await headers() });
      record("redirected");
    } catch (error) {
      logFailure("sign_out_failed", error);
      record("failed");
    }

    // Outside the try: `redirect` works by throwing.
    redirect("/");
  });
}
