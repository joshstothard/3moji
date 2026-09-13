import { atBoundary } from "../../../lib/boundary-log";
import { readViewerSummary } from "../../../lib/viewer";

/**
 * `GET /api/viewer`: who is looking, for the navbar's signed-in indicator
 * ([#193](https://github.com/joshstothard/3moji/issues/193)).
 *
 * **The one response in the app that differs by visitor, so that no page has
 * to.** Reading the session in the root layout or the navbar would render
 * every page per visitor, the public Profile included. Instead the indicator
 * is a client island that asks this route after the page has arrived, and the
 * pages stay the same bytes for everybody. See `docs/architecture/auth.md`
 * § Reading the session.
 *
 * A thin transport adapter under ADR-0006 decision 1: the decision is
 * `viewerSummary`'s, composed by `lib/viewer.ts`. It answers only what the
 * indicator draws, about the session's own Account — never a user id, an email
 * or anybody else's Handle.
 *
 * **Not Better Auth's `/api/auth/get-session`.** That answers the session
 * object itself, and handing it to page JavaScript would undo the cookie's
 * `HttpOnly`.
 *
 * **`private, no-store`, with `Vary: Cookie`.** A shared cache that kept this
 * would hand one person's Handle links to the next visitor. No browser or
 * intermediary may store it, and the island asks with `cache: "no-store"` too.
 *
 * **Its boundary line is `ok` whenever it answers**, whatever the state, so
 * the log cannot become a record of who was signed in (#156).
 */
export async function GET(): Promise<Response> {
  return atBoundary("viewer.read", async () =>
    Response.json(await readViewerSummary(), {
      headers: {
        "cache-control": "private, no-store",
        vary: "Cookie",
      },
    }),
  );
}
