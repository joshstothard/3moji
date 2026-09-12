"use server";

import { canonicalise } from "@template/core";
import { redirect } from "next/navigation";

import { getServices } from "../lib/services";

/** What the sign-in form is told. There is no success case: success redirects. */
export type SignInState =
  | { readonly state: "idle" }
  | { readonly state: "invalid" }
  | { readonly state: "failed" };

/**
 * Whether Better Auth refused because the address is not verified yet.
 *
 * **Not `instanceof APIError`.** Better Auth raises its error from inside an ESM
 * realm of its own under `--experimental-vm-modules`, so an `instanceof` check
 * silently fails in tests while appearing to work in production — the trap
 * `quality-strategy.md` records. The properties are read instead, narrowed from
 * `unknown`, and both spellings are accepted because the status is a name in
 * some versions and a number in others.
 */
function isUnverified(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;

  const status = "status" in error ? error.status : undefined;
  if (status === "FORBIDDEN" || status === 403) return true;

  if (
    !("body" in error) ||
    typeof error.body !== "object" ||
    error.body === null
  ) {
    return false;
  }
  const code = "code" in error.body ? error.body.code : undefined;
  return code === "EMAIL_NOT_VERIFIED";
}

/**
 * Sign in with an email and password.
 *
 * **The 403 is the interesting case, and it is not a failure.**
 * `requireEmailVerification` makes Better Auth refuse an unverified Account
 * with `403 EMAIL_NOT_VERIFIED`, and #82's acceptance criterion is that this
 * renders as the **hold screen with a resend action** rather than as an error.
 * Somebody in that state has done nothing wrong: they claimed a Handle, their
 * link expired over lunch, and they tried the front door instead. Showing them
 * "sign-in failed" would be both unhelpful and untrue — their Handle is still
 * held.
 *
 * So the 403 is turned into a redirect to that person's own hold screen, naming
 * their Handle. Finding out which Handle takes one read, and it is worth it:
 * "your Handle is still held" with the Handle shown is a different sentence
 * from the same words without it.
 *
 * A wrong password is a different thing entirely and stays on the form. The two
 * are deliberately not merged: an unverified Account that gave the *wrong*
 * password gets `401` from Better Auth, before verification is ever considered,
 * so no amount of guessing here reveals whether an address is registered.
 */
export async function signInAction(formData: FormData): Promise<SignInState> {
  const email = formData.get("email");
  const password = formData.get("password");

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.trim() === "" ||
    password === ""
  ) {
    return { state: "invalid" };
  }

  let destination = "/";

  try {
    const { auth } = getServices();
    await auth.api.signInEmail({
      body: { email: email.trim(), password },
    });
  } catch (error) {
    if (!isUnverified(error)) {
      // Wrong credentials, and nothing more is said about which half was wrong.
      return { state: "invalid" };
    }

    try {
      destination = await holdScreenFor(email.trim());
    } catch (lookupError) {
      console.error(
        JSON.stringify({
          event: "hold_screen_lookup_failed",
          message:
            lookupError instanceof Error
              ? lookupError.message
              : "unknown error",
        }),
      );
      return { state: "failed" };
    }
  }

  // Outside the try: `redirect` works by throwing.
  redirect(destination);
}

/**
 * The same thing, shaped for a `<form action=…>`.
 *
 * A form action must return nothing, while {@link signInAction} returns the
 * state a client component would render — so the two cannot be the same
 * function. This one turns that state into a redirect back to the form,
 * carrying `?error=`, which is what makes the page work with **no JavaScript at
 * all**: the message arrives as a fresh render rather than as client state.
 *
 * The query parameter says what went wrong and nothing about who: `invalid`
 * covers a wrong password and an address with no Account alike, because Better
 * Auth answers both with the same 401 and so must we.
 */
export async function signInFormAction(formData: FormData): Promise<void> {
  const result = await signInAction(formData);
  // Reached only when sign-in did not succeed: a success redirects out of
  // `signInAction` by throwing, and never returns here.
  redirect(`/sign-in?error=${result.state}`);
}

/**
 * That person's own hold screen, naming their Handle if they have one.
 *
 * The anonymous screen is the fallback rather than an error: an Account with no
 * Handle should not exist (ADR-0004 decision 4 makes them one atomic act), and
 * if one somehow does, the resend form still works without naming a Handle.
 */
async function holdScreenFor(email: string): Promise<string> {
  const { accounts } = getServices();

  const account = await accounts.byEmail(email);
  if (account === undefined) return "/claim/held?reason=unverified";

  const owned = await accounts.handleOf(account.userId);
  if (owned === undefined) return "/claim/held?reason=unverified";

  const result = canonicalise(owned.key);
  if (!result.ok) return "/claim/held?reason=unverified";

  // `encoded`, never the key: a raw emoji in a `Location` header fails Node's
  // header validation with `ERR_INVALID_CHAR` and serves a 500.
  return `/claim/held/${result.encoded}?reason=unverified`;
}
