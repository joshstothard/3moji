import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  buildContentSecurityPolicy,
  CONTENT_SECURITY_POLICY_HEADER,
  generateNonce,
  NONCE_HEADER,
  policyModeOf,
} from "./lib/content-security-policy";
import {
  CORRELATION_ID_HEADER,
  resolveCorrelationId,
  VERCEL_ID_HEADER,
} from "./lib/correlation-id";

/**
 * Give every request a correlation id (#155) and a Content Security Policy
 * with a fresh nonce (#205).
 *
 * The policy is set on the request as well as the response: Next.js reads the
 * nonce from the request's `Content-Security-Policy` header and puts it on the
 * scripts it renders, so application code never reads it — the public Profile
 * still calls no `headers()` (#193). A client-sent `x-nonce` or policy is
 * overwritten, never trusted. The policy itself is in
 * `lib/content-security-policy.ts`.
 *
 * The correlation id:
 *
 * The id is a well-formed `x-vercel-id` when Vercel's edge sent one, otherwise
 * a random UUID; a malformed value is replaced and never echoed, and a
 * client-sent `x-correlation-id` is overwritten rather than trusted (the rule
 * is in `lib/correlation-id.ts`). It is set on the request the application
 * sees — read it with `lib/request-context.ts` — and on the response as
 * `x-correlation-id`, so a user reporting a failure can quote it.
 *
 * **This changes no routing.** It always answers `NextResponse.next()`: no
 * rewrite, no redirect, no response of its own.
 */
export function proxy(request: NextRequest): NextResponse {
  const id = resolveCorrelationId(request.headers.get(VERCEL_ID_HEADER));
  const nonce = generateNonce();
  const policy = buildContentSecurityPolicy(
    nonce,
    policyModeOf(process.env.NODE_ENV),
  );

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CORRELATION_ID_HEADER, id);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set(CONTENT_SECURITY_POLICY_HEADER, policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(CORRELATION_ID_HEADER, id);
  response.headers.set(CONTENT_SECURITY_POLICY_HEADER, policy);
  return response;
}

/**
 * Every path except Next.js's static output and the metadata files.
 *
 * Two exclusions are deliberately absent. **`/api` stays in**: the auth API is
 * the main boundary #156 logs. **Nothing is excluded by file extension or by a
 * dot**: a word alias such as `/ice-cube.ice-cube.ice-cube` (ADR-0008) is a
 * page with dots in it, and server actions are POSTs to the page's own path, so
 * a dot rule would silently drop both. `proxy.test.ts` pins both lists.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico$|icon\\.svg$|sitemap\\.xml$|robots\\.txt$).*)",
  ],
};
