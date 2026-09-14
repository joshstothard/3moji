"use server";

import { requestPasswordReset, setNewPassword } from "@template/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { atBoundary, type BoundaryOutcome } from "../lib/boundary-log";
import { clientAddressFrom } from "../lib/client-address";
import { getServices } from "../lib/services";
import { logFailure } from "../lib/log-error";
import type {
  ResetRequestNotice,
  SetNewPasswordError,
} from "./password-reset-state";

/**
 * The boundary outcome of each request notice (#156). `sent` is what a
 * registered and an unregistered address both get from the domain, so both log
 * the same `redirected`.
 */
function outcomeOfRequest(notice: ResetRequestNotice): BoundaryOutcome {
  switch (notice) {
    case "sent":
      return "redirected";
    case "invalid":
    case "link-invalid":
      return "rejected";
    case "rate-limited":
      return "rate-limited";
    case "failed":
      return "failed";
  }
}

/**
 * Ask for a password-reset link
 * ([#192](https://github.com/joshstothard/3moji/issues/192)).
 *
 * A thin transport adapter under
 * [ADR-0006](../../../../docs/adr/0006-nextjs-on-vercel-is-the-whole-application.md)
 * decision 1. **Every rule lives in the domain**: the per-client limit asked
 * before the address is read, the identical answer for a registered and an
 * unregistered address, and the 500 ms floor are all `requestPasswordReset`'s.
 *
 * It answers with a redirect back to the form carrying `?notice=`, so the form
 * works with no JavaScript. The notice says what happened and nothing about
 * who: the address never travels in the query string.
 *
 * A non-string `email` is handed to the domain as an empty address rather than
 * refused here, so it is counted against the limit like any other submission.
 */
export async function requestPasswordResetFormAction(
  formData: FormData,
): Promise<void> {
  await atBoundary("password-reset.request", async (record) => {
    const notice = await requestReset(formData);
    // Outside any try: `redirect` works by throwing.
    record(outcomeOfRequest(notice));
    redirect(`/reset-password?notice=${notice}`);
  });
}

async function requestReset(formData: FormData): Promise<ResetRequestNotice> {
  const email = formData.get("email");

  try {
    const { resetRequestClientRateLimiter, passwordResetter, clock } =
      getServices();
    const outcome = await requestPasswordReset({
      email: typeof email === "string" ? email : "",
      clientAddress: clientAddressFrom(await headers()),
      clientLimiter: resetRequestClientRateLimiter,
      resetter: passwordResetter,
      clock,
    });
    return outcome.state;
  } catch (error) {
    // The request failed before any email was handed off: a misconfigured
    // deployment, or a limiter or database that cannot be reached. A failed
    // send never lands here, because the email goes out in the background and
    // its failure is only logged (#216), so the page says "sent" either way.
    // Logged without its message (#134), and never answered `sent`: a person
    // told a link is on its way would wait for one that never comes.
    logFailure("password_reset_request_failed", error);
    return "failed";
  }
}

/**
 * Set a new password from a reset link's token (#192).
 *
 * The token arrives in a hidden field, copied from the page's path segment, and
 * is public input. Where each answer goes:
 *
 * - **`reset`** → the sign-in page, saying so. Every session was revoked,
 *   this browser's included, so signing in again is the next thing to do.
 * - **`invalid-link`** → the request form, which says the link no longer works
 *   and offers a new one right there — and leaves the dead token out of the
 *   address bar and the history.
 * - **a password Better Auth refuses** → back to the same link, so the person
 *   can try again with the token they still hold.
 */
export async function setNewPasswordFormAction(
  formData: FormData,
): Promise<void> {
  await atBoundary("password-reset.set", async (record) => {
    const token = formData.get("token");
    const password = formData.get("password");
    const tokenText = typeof token === "string" ? token : "";

    let destination: string;
    try {
      const { passwordResetter } = getServices();
      const outcome = await setNewPassword({
        token: tokenText,
        newPassword: typeof password === "string" ? password : "",
        resetter: passwordResetter,
      });
      destination = destinationOf(outcome.state, tokenText);
      record(outcome.state === "reset" ? "redirected" : "rejected");
    } catch (error) {
      logFailure("password_reset_set_failed", error);
      destination = linkWithError(tokenText, "failed");
      record("failed");
    }

    redirect(destination);
  });
}

function destinationOf(
  state: "reset" | "invalid-link" | "password-too-short" | "password-too-long",
  token: string,
): string {
  switch (state) {
    case "reset":
      return "/sign-in?notice=password-reset";
    case "invalid-link":
      return "/reset-password?notice=link-invalid";
    case "password-too-short":
      return linkWithError(token, "too-short");
    case "password-too-long":
      return linkWithError(token, "too-long");
  }
}

/**
 * Back to the link, with `?error=`. The token is percent-encoded into one path
 * segment, so a crafted value cannot add a segment or leave this route — and
 * an empty one, which the domain already answered as an invalid link, never
 * reaches here but would land on the request form if it did.
 */
function linkWithError(token: string, error: SetNewPasswordError): string {
  if (token === "") return "/reset-password?notice=link-invalid";
  return `/reset-password/${encodeURIComponent(token)}?error=${error}`;
}
