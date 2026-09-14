import { searchHandles } from "@template/core";

import { atBoundary } from "../../../lib/boundary-log";
import { clientAddressFrom } from "../../../lib/client-address";
import { logFailure } from "../../../lib/log-error";
import { getServices } from "../../../lib/services";

/**
 * `GET /api/search?q=`: the header search
 * ([ADR-0012](../../../../../../docs/adr/0012-header-search-lists-claimed-handles-with-display-names-capped-and-rate-limited.md),
 * [#254](https://github.com/joshstothard/3moji/issues/254)).
 *
 * A thin transport adapter under ADR-0006 decision 1: what matches, the caps
 * and the order are `searchHandles`'s, and the limit is
 * `searchClientRateLimiter`'s. The header island asks this after the page has
 * arrived, so no page — the layout and the navbar included — reads a request
 * header to draw the search.
 *
 * - **Every request is counted first** (decision 6), handed the client address
 *   and nothing else, before the query is read. Over the limit is a plain
 *   `429`: no body, no `Retry-After`.
 * - **`private, no-store` on every answer** (decision 7), so no shared cache
 *   can answer a search around the limit. There is no response floor: a search
 *   reveals only public Profile data, never whether an Account or an email
 *   address exists.
 * - **The query is never logged.** The boundary line has no field that could
 *   carry it, and a failure is logged through `logFailure`, which writes no
 *   message. `lib/api-boundaries.test.ts` binds an email address and a token
 *   into `q` and asserts neither appears anywhere.
 * - **A failure answers `500` with no body**, recorded `failed`: a limiter that
 *   cannot count refuses to search rather than searching unmetered.
 */
const HEADERS = { "cache-control": "private, no-store" } as const;

export async function GET(request: Request): Promise<Response> {
  return atBoundary("search.read", async (record) => {
    try {
      const services = getServices();
      const admission = await services.searchClientRateLimiter.admit(
        clientAddressFrom(request.headers),
      );
      if (admission.state === "rate-limited") {
        record("rate-limited");
        return new Response(null, { status: 429, headers: HEADERS });
      }

      const query = new URL(request.url).searchParams.get("q") ?? "";
      const search = await searchHandles({
        query,
        index: services.handleSearch,
        profiles: services.profiles,
      });
      return Response.json(search, { headers: HEADERS });
    } catch (error) {
      logFailure("search_failed", error);
      record("failed");
      return new Response(null, { status: 500, headers: HEADERS });
    }
  });
}
