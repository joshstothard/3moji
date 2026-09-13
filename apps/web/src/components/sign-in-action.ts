"use server";

import { canonicalise } from "@template/core";
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

/** What the sign-in form is told. There is no success case: success redirects. */
export type SignInState =
  | { readonly state: "idle" }
  | { readonly state: "invalid" }
  | { readonly state: "rate-limited" }
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
  return atBoundary("sign-in.submit", (record) => signIn(formData, record), {
    outcomeOf: outcomeOfSignIn,
  });
}

/**
 * The boundary outcome of an answer that did not redirect (#156). A wrong
 * password and an address with no Account are both Better Auth's 401, so both
 * are `rejected`; a signed-in or unverified Account records `redirected`.
 */
function outcomeOfSignIn(result: SignInState): BoundaryOutcome {
  switch (result.state) {
    case "idle":
      return "ok";
    case "invalid":
      return "rejected";
    case "rate-limited":
      return "rate-limited";
    case "failed":
      return "failed";
  }
}

/**
 * Whether this client may attempt a sign-in at all (#180).
 *
 * **Better Auth's own limiter never sees this form.** It runs in its router's
 * `onRequest`, and `auth.api.signInEmail` below is a server-side call that
 * never passes through it — so without this, `POST /api/auth/sign-in/email`
 * would be limited while the form in front of the same credential check
 * accepted unbounded guesses.
 *
 * **Asked first, before the form is read or any credential evaluated**, and
 * handed the client address alone. A registered and an unregistered address, a
 * right and a wrong password, are therefore counted and refused identically —
 * a correct password beyond the limit is refused exactly like a wrong one — and
 * no credential-dependent work runs before the answer, so neither can its
 * timing differ by one.
 *
 * **Fails closed, in its own `try`.** The credentials `try` below turns any
 * throw into `invalid`; a store that cannot count must instead refuse, and be
 * logged, rather than read as a wrong password.
 */
async function signInAdmission(): Promise<SignInState | undefined> {
  try {
    const { signInClientRateLimiter } = getServices();
    const admission = await signInClientRateLimiter.admit(
      clientAddressFrom(await headers()),
    );
    return admission.state === "rate-limited"
      ? { state: "rate-limited" }
      : undefined;
  } catch (error) {
    logFailure("sign_in_rate_limit_failed", error);
    return { state: "failed" };
  }
}

/**
 * Sign-in itself, behind both exported actions — unexported so that
 * `signInFormAction` writes one boundary line, not two.
 */
async function signIn(
  formData: FormData,
  record: RecordOutcome,
): Promise<SignInState> {
  const refused = await signInAdmission();
  if (refused !== undefined) return refused;

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
      logFailure("hold_screen_lookup_failed", lookupError);
      return { state: "failed" };
    }
  }

  // Outside the try: `redirect` works by throwing.
  record("redirected");
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
 * Auth answers both with the same 401 and so must we; `rate-limited` is decided
 * before either is looked at (#180).
 */
export async function signInFormAction(formData: FormData): Promise<void> {
  await atBoundary("sign-in.form", async (record) => {
    const result = await signIn(formData, record);
    // Reached only when sign-in did not succeed: a success redirects out of
    // `signIn` by throwing, and never returns here. The redirect back to the
    // form carries the refusal, so the refusal is the outcome.
    record(outcomeOfSignIn(result));
    redirect(`/sign-in?error=${result.state}`);
  });
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
