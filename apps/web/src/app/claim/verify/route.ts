import { finaliseClaim, type ClaimFinalisation } from "@template/core";

import { getServices } from "../../../lib/services";

/**
 * Where a verification link points, and where a Claim becomes final.
 *
 * ## Why the link comes here instead of to Better Auth's own endpoint
 *
 * Better Auth would happily serve its own `/api/auth/verify-email?token=…`, and
 * that is the URL it hands us. It is not used, for two reasons that only a real
 * run makes visible:
 *
 * 1. **Invalidation needs somewhere to stand.** The verification token is a
 *    signed JWT the library never stores, so every link it has issued stays
 *    valid for its hour and a resend cannot delete anything. "Only the newest
 *    link works" has to be enforced *before* verification, against our own
 *    record — and nothing can run before an endpoint the library owns.
 * 2. **Its failure mode throws the token away.** With a `callbackURL`, a
 *    rejected token becomes a redirect carrying `?error=token_expired` and
 *    nothing else — so the expired-link page could not say *which* Handle is
 *    still held, which is the one thing #82 insists it must say. Without a
 *    `callbackURL`, a rejection is a bare 401 with no page at all.
 *
 * ## A route handler rather than a page
 *
 * Because signing somebody in means setting a cookie, and in the App Router
 * only a route handler or a server action may do that. A server component that
 * called `verifyEmail` would verify the address and then fail to sign anybody
 * in, silently — `autoSignInAfterVerification` would be on and doing nothing.
 * Here, Better Auth's `Set-Cookie` headers are forwarded onto the redirect.
 *
 * Every answer is a redirect to a page that explains itself, and **none of them
 * is an error page**: five of the six states leave the Handle held.
 */
export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token") ?? "";

  const { dispatches, accounts, claimFinaliser, clock } = getServices();

  const result = await finaliseClaim({
    token,
    dispatches,
    directory: accounts,
    finaliser: claimFinaliser,
    clock,
  });

  // A failure to *reach* the database propagates as a 500 rather than becoming
  // "that link expired". The two look identical to a visitor and are opposite
  // in meaning: one is retryable in an hour, the other in a moment, and telling
  // somebody their link expired when it did not sends them round a loop that
  // cannot end. Nothing is caught here for the same reason `finaliseClaim`
  // separates `link-expired` from an exception.

  return redirectTo(destinationFor(result), setCookiesOf(result));
}

/**
 * The page each answer belongs on.
 *
 * `encodeURIComponent`, never the raw key: a raw emoji in a `Location` header
 * fails Node's own header validation with `ERR_INVALID_CHAR` and serves a 500
 * — the lesson `/[handle]` learned the hard way, and the reason that route
 * redirects with `encoded` rather than `key`.
 */
function destinationFor(result: ClaimFinalisation): string {
  switch (result.state) {
    case "link-unknown":
      // Nothing truthful to name, so the anonymous screen.
      return "/claim/held?reason=link-unknown";
    case "claimed":
    case "already-claimed":
      return `/claim/verified/${encodeURIComponent(result.key)}`;
    case "link-superseded":
      return `/claim/held/${encodeURIComponent(result.key)}?reason=link-superseded`;
    case "link-expired":
      return `/claim/held/${encodeURIComponent(result.key)}?reason=link-expired`;
    case "hold-expired":
      return `/claim/held/${encodeURIComponent(result.key)}?reason=hold-expired`;
  }
}

/**
 * The cookies Better Auth set, if it set any.
 *
 * **Forwarding these is the sign-in.** `autoSignInAfterVerification` creates the
 * session row and hands back a `Set-Cookie`; dropping it here would verify the
 * address and leave the new owner at a page they are not signed in to.
 *
 * `getSetCookie()` rather than `get("set-cookie")`, because there can be more
 * than one and `get` folds them into a single comma-joined string that no
 * browser will parse back into two cookies.
 */
function setCookiesOf(result: ClaimFinalisation): readonly string[] {
  return result.state === "claimed" ? result.headers.getSetCookie() : [];
}

/**
 * A 303, not a 302.
 *
 * The link arrives as a `GET`, so the method is not the reason — the reason is
 * that 303 is the status that means "go and look over there instead", and it is
 * never cached. A 302 from a URL carrying a one-time token is a URL an
 * intermediary may remember.
 */
function redirectTo(location: string, setCookies: readonly string[]): Response {
  const headers = new Headers({
    location,
    "cache-control": "no-store",
  });
  for (const cookie of setCookies) {
    headers.append("set-cookie", cookie);
  }
  return new Response(null, { status: 303, headers });
}
