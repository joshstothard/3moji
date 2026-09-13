"use server";

import { canonicalise, resendVerification } from "@template/core";
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
import { holdReasonFrom, type ResendNotice } from "./claim-state";

/**
 * Where the answer is shown: this Handle's hold screen, or the anonymous one.
 *
 * The segment is re-canonicalised rather than trusted. It arrives from a hidden
 * form field, which is public input — and a value put straight into a
 * `Location` header is a redirect anybody can aim. `canonicalise` gives back
 * the percent-encoded canonical spelling, which is also the only safe thing to
 * put in a header: a raw emoji there fails Node's own header validation with
 * `ERR_INVALID_CHAR` and serves a 500 (the lesson `/[handle]` already learned).
 */
function destination(
  form: FormData,
  notice: ResendNotice,
  retrySeconds?: number,
): string {
  const handle = form.get("handle");
  const reason = form.get("reason");
  const reasonField = typeof reason === "string" ? reason : undefined;
  // Carried back so the screen keeps saying what brought them here. It is
  // whitelisted by `holdReasonFrom`, so a crafted value cannot make the page
  // claim a healthy hold has run out.
  const query = new URLSearchParams({
    reason: holdReasonFrom(reasonField),
    notice,
  });
  if (retrySeconds !== undefined) {
    query.set("retry", String(retrySeconds));
  }

  if (typeof handle === "string") {
    const result = canonicalise(handle);
    if (result.ok) {
      return `/claim/held/${result.encoded}?${query.toString()}`;
    }
  }
  return `/claim/held?${query.toString()}`;
}

/**
 * Ask for a fresh verification link.
 *
 * A thin transport adapter, which is all a server action is allowed to be under
 * [ADR-0006](../../../../docs/adr/0006-nextjs-on-vercel-is-the-whole-application.md)
 * decision 1. It validates the form, calls the use case, and turns the answer
 * into a redirect. **Every rule lives in the domain**: the limits, the
 * indistinguishable answer for an unknown address, and the timing floor are all
 * `resendVerification`'s, so a second transport cannot get them wrong.
 *
 * `email` is typed `unknown` because a server action is a public HTTP endpoint:
 * whatever a client sends arrives here, and TypeScript's word for it is worth
 * nothing at runtime.
 *
 * It answers with a redirect rather than returned state so the form works with
 * no JavaScript — the notice arrives as a fresh render of the hold screen. The
 * cost is that the notice travels in the query string, which is exactly why the
 * *address* never does: `?notice=sent` says what happened, and nothing about
 * who it happened to.
 */
export async function requestNewVerificationLink(
  formData: FormData,
): Promise<void> {
  await atBoundary("verification.resend", (record) =>
    requestLink(formData, record),
  );
}

/**
 * The boundary outcome of each notice (#156). `sent` is what an unknown
 * address, a verified one and a genuine unverified Account all get from the
 * domain, so all three log the same `redirected`.
 */
function outcomeOfNotice(notice: ResendNotice): BoundaryOutcome {
  switch (notice) {
    case "sent":
      return "redirected";
    case "too-soon":
    case "too-many":
      return "rate-limited";
    case "invalid":
      return "rejected";
    case "failed":
      return "failed";
  }
}

async function requestLink(
  formData: FormData,
  record: RecordOutcome,
): Promise<void> {
  const email = formData.get("email");

  if (typeof email !== "string" || email.trim() === "") {
    record(outcomeOfNotice("invalid"));
    redirect(destination(formData, "invalid"));
    return;
  }

  let notice: ResendNotice = "failed";
  let retrySeconds: number | undefined;

  try {
    const {
      accounts,
      dispatches,
      verificationMailer,
      clock,
      resendClientRateLimiter,
    } = getServices();
    const outcome = await resendVerification({
      email: email.trim(),
      // Per client address, beside the per-Account limit (#158).
      clientAddress: clientAddressFrom(await headers()),
      clientLimiter: resendClientRateLimiter,
      directory: accounts,
      dispatches,
      mailer: verificationMailer,
      clock,
    });

    notice = outcome.state === "sent" ? "sent" : outcome.state;
    if (outcome.state !== "sent") {
      retrySeconds = Math.ceil(outcome.retryAfterMs / 1000);
    }
  } catch (error) {
    // A misconfigured deployment or an unreachable database. Worth a log line
    // rather than a shrug, and worth *not* telling the visitor a link is on its
    // way when none is: they would wait for an email that never comes.
    logFailure("verification_resend_failed", error);
  }

  // Outside the try: `redirect` works by throwing, so calling it inside would
  // be caught by our own handler and reported as a failure.
  record(outcomeOfNotice(notice));
  redirect(destination(formData, notice, retrySeconds));
}
