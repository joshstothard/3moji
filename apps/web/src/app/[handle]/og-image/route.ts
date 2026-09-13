import { atBoundary } from "../../../lib/boundary-log";
import { ogImageInputForSegment } from "../../../lib/og/handle-image";
import { ogImageResponse } from "../../../lib/og/image";

/**
 * A Handle's Open Graph image: `3moji.me/🧊🧊🧊/og-image`
 * ([#161](https://github.com/joshstothard/3moji/issues/161)).
 *
 * A thin adapter, as every route is: the segment arrives still percent-encoded
 * and is handed on untouched. For a claimed Handle it draws the three emoji
 * and the display name; for **every** other segment — available, held,
 * reserved, unknown, non-canonical, or not a Handle at all — it draws the
 * generic image with the same headers, and never a 404 or a redirect.
 *
 * One boundary line per call (#156), `ok` for both kinds of image, so the log
 * records no more about a Handle's state than the image does. A render failure
 * inside `next/og` happens while the body streams, after this has returned;
 * a failed read or a failure to construct the response is logged `failed`.
 */
export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly handle: string }> },
): Promise<Response> {
  return atBoundary("og-image.handle", async () => {
    const { handle } = await params;
    return ogImageResponse(await ogImageInputForSegment(handle));
  });
}
