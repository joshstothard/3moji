import { atBoundary } from "../../lib/boundary-log";
import { GENERIC_IMAGE } from "../../lib/og/image-input";
import { ogImageResponse } from "../../lib/og/image";

/**
 * The generic Open Graph image: what every page that is not a claimed Profile
 * unfurls with ([#161](https://github.com/joshstothard/3moji/issues/161)).
 *
 * The same drawing and the same headers as `/[handle]/og-image` answers for a
 * Handle that is not claimed, so the two cannot be told apart.
 *
 * One boundary line per call (#156): `ok` when it answers. A render failure
 * inside `next/og` happens while the body streams, after this has returned,
 * so only a failure to construct the response is logged `failed`.
 */
export async function GET(): Promise<Response> {
  return atBoundary("og-image.generic", () =>
    Promise.resolve(ogImageResponse(GENERIC_IMAGE)),
  );
}
