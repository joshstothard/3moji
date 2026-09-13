"use server";

import { submitClaim } from "@template/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  atBoundary,
  type BoundaryOutcome,
  type RecordOutcome,
} from "../lib/boundary-log";
import { clientAddressFrom } from "../lib/client-address";
import { getServices } from "../lib/services";
import { logFailure } from "../lib/log-error";

/**
 * What the claim form is told when the Claim did not go through.
 *
 * There is deliberately **no success case**: a Claim that was accepted
 * redirects to the hold screen, so the only way back to the form is a
 * rejection. That is also what keeps the non-enumeration promise out of this
 * file's hands — an already-registered address is not a rejection, so there is
 * nothing here that could leak it.
 */
export type ClaimFormState =
  | { readonly state: "idle" }
  | { readonly state: "taken"; readonly because: string }
  | { readonly state: "not-claimable" }
  | { readonly state: "not-a-handle" }
  | { readonly state: "invalid" }
  /**
   * Too many submissions from this client address or naming this email
   * address (#157) — deliberately without saying which, or for how long.
   */
  | { readonly state: "rate-limited" }
  | { readonly state: "failed" };

/**
 * Submit a Claim.
 *
 * A thin transport adapter over {@link submitClaim}, which is where every rule
 * lives — the atomic sign-up and hold, the Reserved Handle re-check, the
 * collision email, and the timing floor that makes an already-registered
 * address indistinguishable from a new one.
 *
 * **It cannot tell the difference either, and that is the design.**
 * `submitClaim` answers `pending` for both, so this action has one branch where
 * a less careful transport would have two. Both end at the same URL.
 *
 * **It supplies the client address and nothing else about the limit** (#157).
 * The address comes from the forwarded headers (see `lib/client-address.ts` for
 * exactly what that trusts); the rule, the counters and the secret the buckets
 * are hashed under all live in `packages/core`. A limiter that cannot count
 * throws, and the catch below refuses the Claim and logs it: it fails closed.
 *
 * Every field is read as `unknown`: a server action is a public HTTP endpoint,
 * and whatever a client posts arrives here.
 *
 * **The claim form calls it**, through {@link claimFormAction}: the builder
 * renders `claim-form.tsx` once its Handle reads as available, on `/` and on an
 * unclaimed `/[handle]` alike
 * ([#115](https://github.com/joshstothard/3moji/issues/115)).
 */
export async function submitClaimAction(
  formData: FormData,
): Promise<ClaimFormState> {
  return atBoundary("claim.submit", (record) => claim(formData, record), {
    outcomeOf: outcomeOfClaim,
  });
}

/**
 * The boundary outcome of an answer that returned to the form (#156).
 *
 * Every refusal of the input is one `rejected`, so the log cannot draw a
 * distinction the form's copy does not. The accepted Claim never reaches here:
 * it records `redirected` and redirects — **for a fresh Claim and a collision
 * alike**, which is what keeps the boundary line as indistinguishable as the
 * URL.
 */
function outcomeOfClaim(result: ClaimFormState): BoundaryOutcome {
  switch (result.state) {
    case "idle":
      return "ok";
    case "taken":
    case "not-claimable":
    case "not-a-handle":
    case "invalid":
      return "rejected";
    case "rate-limited":
      return "rate-limited";
    case "failed":
      return "failed";
  }
}

/**
 * The Claim itself, behind both exported actions. Unexported so that each
 * HTTP call writes exactly one boundary line: `claimFormAction` calling
 * `submitClaimAction` would write two.
 */
async function claim(
  formData: FormData,
  record: RecordOutcome,
): Promise<ClaimFormState> {
  const segment = formData.get("handle");
  const email = formData.get("email");
  const password = formData.get("password");

  if (
    typeof segment !== "string" ||
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.trim() === "" ||
    password === ""
  ) {
    return { state: "invalid" };
  }

  let destination: string;

  try {
    const {
      claims,
      accounts,
      clock,
      resetRequestUrl,
      emailFrom,
      emailSender,
      claimRateLimiter,
    } = getServices();

    const result = await submitClaim({
      segment,
      email: email.trim(),
      password,
      store: claims,
      clock,
      directory: accounts,
      emailSender,
      resetRequestUrl,
      from: emailFrom,
      rateLimiter: claimRateLimiter,
      clientAddress: clientAddressFrom(await headers()),
    });

    switch (result.state) {
      case "pending":
        // The one and only success URL, for a fresh Claim and a collision
        // alike. `encoded`, never the key: a raw emoji in a `Location` header
        // fails Node's header validation and serves a 500.
        destination = `/claim/held/${result.handle.encoded}?reason=pending`;
        break;
      case "taken":
        return { state: "taken", because: result.because };
      case "not-claimable":
        return { state: "not-claimable" };
      case "not-a-handle":
        return { state: "not-a-handle" };
      case "rate-limited":
        return { state: "rate-limited" };
    }
  } catch (error) {
    logFailure("claim_submit_failed", error);
    return { state: "failed" };
  }

  // Outside the try: `redirect` works by throwing, and catching it here would
  // report a successful Claim as a failure.
  record("redirected");
  redirect(destination);
}

/**
 * {@link submitClaimAction}, in the `(previous, formData)` shape
 * `useActionState` calls an action with — which is what the claim form uses
 * ([#115](https://github.com/joshstothard/3moji/issues/115)).
 *
 * The previous answer is ignored: every submission is a fresh Claim, and there
 * is nothing about the last rejection the next one should depend on. It adds no
 * branch, so the one-success-URL property above is unchanged.
 */
export async function claimFormAction(
  _previous: ClaimFormState,
  formData: FormData,
): Promise<ClaimFormState> {
  return atBoundary("claim.form", (record) => claim(formData, record), {
    outcomeOf: outcomeOfClaim,
  });
}
