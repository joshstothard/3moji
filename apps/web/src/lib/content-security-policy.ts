/**
 * The Content Security Policy, built per request around a nonce (#205).
 *
 * **Option 1, chosen by the repo owner: a nonce on every page.** Next.js puts
 * two inline scripts on every page, one of them a page payload that changes per
 * page and per build, so a strict `script-src` needs a nonce, and a nonce only
 * exists at request time. The root layout therefore renders every page per
 * request (`export const dynamic` in `app/layout.tsx`).
 *
 * `proxy.ts` generates the nonce, sets this policy on the request — Next.js
 * reads the nonce from there and puts it on the scripts it renders — and on the
 * response. It is not in `security-headers.ts`, which holds only what is the
 * same on every response.
 *
 * **Development differs by exactly two allowances**: React needs `eval` in
 * `next dev` to rebuild server error stacks, and `next dev` injects inline
 * styles. Neither is in the production policy, which `content-security-policy
 * .test.ts` pins in full. `upgrade-insecure-requests` is left out of both,
 * because it breaks `http://localhost`.
 */
export const CONTENT_SECURITY_POLICY_HEADER = "Content-Security-Policy";

/** The request header the nonce is also forwarded on, as Next.js documents. */
export const NONCE_HEADER = "x-nonce";

export type PolicyMode = "production" | "development";

/** 128 bits: unguessable for the life of one response. */
const NONCE_BYTES = 16;

/**
 * Base64 only. Anything else could close the `'nonce-…'` source or start a new
 * directive, so a nonce outside this alphabet is refused rather than escaped.
 */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** `development` only under `next dev`; production, test and unset are strict. */
export function policyModeOf(nodeEnv: string | undefined): PolicyMode {
  return nodeEnv === "development" ? "development" : "production";
}

/** A fresh nonce: 16 bytes from the platform's CSPRNG, base64-encoded. */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  return btoa(String.fromCharCode(...bytes));
}

export function buildContentSecurityPolicy(
  nonce: string,
  mode: PolicyMode,
): string {
  if (!BASE64.test(nonce)) {
    throw new Error("A CSP nonce must be non-empty base64.");
  }

  const development = mode === "development";
  const directives: readonly (readonly string[])[] = [
    ["default-src", "'self'"],
    [
      "script-src",
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(development ? ["'unsafe-eval'"] : []),
    ],
    development
      ? ["style-src", "'self'", "'unsafe-inline'"]
      : ["style-src", "'self'", `'nonce-${nonce}'`],
    ["img-src", "'self'", "data:", "blob:"],
    ["font-src", "'self'"],
    ["connect-src", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
  ];

  return directives.map((directive) => directive.join(" ")).join("; ");
}
