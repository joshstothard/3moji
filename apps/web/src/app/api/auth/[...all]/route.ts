import { toNextJsHandler } from "better-auth/next-js";

import { getServices } from "../../../../lib/services";

/**
 * Better Auth's whole HTTP surface: sign-in, verification, reset.
 *
 * **Not sign-up.** `createAuth` refuses `/sign-up/email` and `/sign-in/social`
 * with a 404 before they reach Better Auth, because an Account is created only
 * by the Claim, server-side, beside its Handle (#150, ADR-0004 decision 4).
 * The refusal lives in `packages/core` rather than here so that it holds for
 * whatever transport serves `auth.handler`, and so a real-database test covers it.
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
