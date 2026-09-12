import { toNextJsHandler } from "better-auth/next-js";

import { getServices } from "../../../../lib/services";

/**
 * Better Auth's whole HTTP surface: sign-up, sign-in, verification, reset.
 *
 * A thin transport adapter, which is all a route handler is allowed to be under
 * ADR-0006 decision 1. The handlers resolve services per request rather than at
 * module scope, so `next build` does not need a populated environment.
 */
export async function GET(request: Request): Promise<Response> {
  return toNextJsHandler(getServices().auth).GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return toNextJsHandler(getServices().auth).POST(request);
}
