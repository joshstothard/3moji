/**
 * The security headers that are the same on every response (#205).
 *
 * They are sent from `next.config.ts` on `/:path*`, never from the proxy: the
 * proxy's matcher skips `_next/static`, `_next/image` and the metadata files,
 * and HSTS and `nosniff` belong on those as much as on a page. The Content
 * Security Policy is not here, because it is built per request.
 */
export interface ResponseHeader {
  readonly key: string;
  readonly value: string;
}

export const STATIC_SECURITY_HEADERS: readonly ResponseHeader[] = [
  // Two years, the preload list's minimum. `preload` itself is left out: it is
  // a commitment for the whole domain that is slow to undo, and the owner's.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // `frame-ancestors 'none'` in the CSP is the standard; this is for browsers
  // that predate it, and for responses that carry no CSP.
  { key: "X-Frame-Options", value: "DENY" },
];
