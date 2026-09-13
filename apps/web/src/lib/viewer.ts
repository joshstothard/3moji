import { viewerSummary, type ViewerSummary } from "@template/core";

import { getServices } from "./services";
import { logFailure } from "./log-error";
import { readViewer } from "./session";

/**
 * What the navbar's signed-in indicator is told about the person asking
 * ([#193](https://github.com/joshstothard/3moji/issues/193)).
 *
 * The transport-side wiring of {@link viewerSummary} and nothing more — the
 * split `lib/profile-edit.ts` makes around `profileEditAuthority`. It fetches
 * the two facts the rule needs (who the session says is signed in, and what
 * that Account holds or owns) and hands them over.
 *
 * **Only `GET /api/viewer` may call this.** It reads the session, and a page,
 * a layout or the navbar that read the session would render differently for
 * each visitor — the public Profile's HTML would stop being the same bytes for
 * everybody. `apps/web/eslint.config.mjs` refuses the import where it matters;
 * see `docs/architecture/auth.md` § Reading the session.
 *
 * **Every failure fails closed, and to the least it can show.** No session —
 * including one `readViewer` could not read — is `signed-out`. An Account read
 * that fails for a viewer the session did name is `signed-in` with no Handle:
 * never somebody's links, and never a false "signed out" that would hide the
 * way to sign out.
 */
export async function readViewerSummary(): Promise<ViewerSummary> {
  const viewer = await readViewer();
  if (viewer === undefined) {
    return viewerSummary({ viewer, owned: undefined });
  }

  try {
    const { accounts } = getServices();
    const owned = await accounts.handleOf(viewer.userId);
    return viewerSummary({ viewer, owned });
  } catch (error) {
    logFailure("viewer_summary_read_failed", error);
    return viewerSummary({ viewer, owned: undefined });
  }
}
