"use server";

import { submitClaim } from "@template/core";
import { redirect } from "next/navigation";

import { getServices } from "../lib/services";

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
 * Every field is read as `unknown`: a server action is a public HTTP endpoint,
 * and whatever a client posts arrives here.
 *
 * **The builder does not call this yet** — the picker and its submit button are
 * [#79](https://github.com/joshstothard/3moji/issues/79) and
 * [#80](https://github.com/joshstothard/3moji/issues/80), being built in
 * parallel. It is the endpoint the flow #82 owns needs in order to exist end to
 * end, and wiring a form to it is a one-line change.
 */
export async function submitClaimAction(
  formData: FormData,
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
    const { claims, accounts, clock, resetRequestUrl, emailFrom, emailSender } =
      getServices();

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
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "claim_submit_failed",
        message: error instanceof Error ? error.message : "unknown error",
      }),
    );
    return { state: "failed" };
  }

  // Outside the try: `redirect` works by throwing, and catching it here would
  // report a successful Claim as a failure.
  redirect(destination);
}
