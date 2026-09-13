import { spokenHandle } from "@template/core/browser";
import Link from "next/link";

import en from "../../../../packages/shared/messages/en.json";
import type { HoldReason, ResendNotice } from "./claim-state";

const copy = en.Claim;

interface Wording {
  readonly heading: string;
  readonly body: string;
  /** Whether asking for a new link is the thing to do from here. */
  readonly offersResend: boolean;
  /** Whether picking a Handle again is the thing to do from here. */
  readonly offersPick: boolean;
  /** Whether the Handle is still being held for this person. */
  readonly stillHeld: boolean;
}

/**
 * One wording per reason, as a `Record` over the union rather than a `switch`,
 * so a seventh reason cannot be added without this failing to compile.
 *
 * **`stillHeld` is the load-bearing column.** #82's acceptance criterion is
 * that an expired link with a live Hold *never implies the Handle was lost*, and
 * five of these six states are exactly that situation. Only `hold-expired` has
 * actually lost it. Keeping that as data rather than as prose in six places is
 * what stops the fifth screen someone adds getting it wrong.
 */
const WORDING: Readonly<Record<HoldReason, Wording>> = {
  pending: {
    heading: copy.pendingHeading,
    body: copy.pendingBody,
    offersResend: true,
    offersPick: false,
    stillHeld: true,
  },
  "link-expired": {
    heading: copy.linkExpiredHeading,
    body: copy.linkExpiredBody,
    offersResend: true,
    offersPick: false,
    stillHeld: true,
  },
  "link-superseded": {
    heading: copy.linkSupersededHeading,
    body: copy.linkSupersededBody,
    offersResend: true,
    offersPick: false,
    stillHeld: true,
  },
  unverified: {
    heading: copy.unverifiedHeading,
    body: copy.unverifiedBody,
    offersResend: true,
    offersPick: false,
    stillHeld: true,
  },
  "link-unknown": {
    heading: copy.linkUnknownHeading,
    body: copy.linkUnknownBody,
    /**
     * **Both actions, because we genuinely do not know which applies.**
     *
     * Since #83's lazy expiry landed, the likeliest cause of an unrecognised
     * link is that a later claimant's transaction deleted the unverified
     * Account it belonged to — the dispatch rows cascade away with the `user`
     * row, so the link becomes one we have no record of. Offering only a
     * resend there would leave somebody waiting for an email that can never
     * arrive, because there is no Account left to send it to. Offering only
     * "pick again" would be wrong for the other cause, a link a mail client
     * cut in half, where the hold is alive and well.
     */
    offersResend: true,
    offersPick: true,
    stillHeld: false,
  },
  "hold-expired": {
    heading: copy.holdExpiredHeading,
    body: copy.holdExpiredBody,
    // No resend: confirming an email cannot bring back a Handle somebody else
    // may already have taken.
    offersResend: false,
    offersPick: true,
    stillHeld: false,
  },
};

function format(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, value),
    template,
  );
}

/** The sentence under the form, if the form has already run. */
function noticeText(
  notice: ResendNotice,
  retrySeconds: number | undefined,
): string {
  switch (notice) {
    case "sent":
      return copy.resendSent;
    case "too-soon": {
      const seconds = retrySeconds ?? 60;
      // A singular key rather than "1 seconds". There is no plural machinery
      // here yet and one extra string is cheaper than inventing some; a
      // locale needing more forms will need that machinery anyway.
      return seconds === 1
        ? copy.resendTooSoonOne
        : format(copy.resendTooSoon, { seconds: String(seconds) });
    }
    case "too-many": {
      // Rounded up: "try again in 0 minutes" is not an instruction.
      const minutes = Math.max(1, Math.ceil((retrySeconds ?? 3600) / 60));
      return minutes === 1
        ? copy.resendTooManyOne
        : format(copy.resendTooMany, { minutes: String(minutes) });
    }
    case "invalid":
      return copy.resendInvalid;
    case "failed":
      return copy.resendFailed;
  }
}

export interface HoldScreenProps {
  /**
   * The Handle, when we know which one. Absent only for a link we have no
   * record of, where naming one would be a guess.
   */
  readonly handleKey?: string | undefined;
  /** The percent-encoded canonical segment, for the form to carry back. */
  readonly encoded?: string | undefined;
  readonly reason: HoldReason;
  readonly notice?: ResendNotice | undefined;
  readonly retrySeconds?: number | undefined;
  /**
   * The resend endpoint, injected rather than imported.
   *
   * It is a server action — it reaches the database and Better Auth through
   * `lib/services.ts` — so the one collaborator that leaves the browser is
   * passed in by the page, and a test substitutes a fake
   * (`engineering-standards.md` § The composition root).
   */
  readonly resend: (formData: FormData) => void | Promise<void>;
}

/**
 * The hold screen: what somebody sees between claiming and confirming.
 *
 * It is one component for six states because it is one *situation* — "your
 * Handle is waiting on your email" — and the differences are wording and
 * whether a new link is worth offering.
 *
 * **Resend is the obvious action, not an afterthought**, which is the
 * acceptance criterion and the reason the form is in the flow of the page with
 * a real heading rather than a link in the corner. It is a plain `<form>`
 * posting to a server action, so it works with no JavaScript at all: the answer
 * arrives as a fresh render of this page rather than as client state, which is
 * also why the notice can be announced by a live region without a client
 * component.
 *
 * The emoji carry the meaning, so they are the heading's companion, and
 * `role="img"` with the Spoken Name as the accessible name is what makes a
 * screen reader say "three ice cubes" rather than reading three code points.
 */
export function HoldScreen({
  handleKey,
  encoded,
  reason,
  notice,
  retrySeconds,
  resend,
}: HoldScreenProps) {
  const wording = WORDING[reason];
  // `Array.from`, not a spread: the lint rule forbids spreading a string, and
  // this is the idiom `canonicalise` uses — the string iterator yields code
  // points, and every Emoji Set entry is exactly one (ADR-0005 decision 1).
  const spoken =
    handleKey === undefined ? undefined : spokenHandle(Array.from(handleKey));

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div className="text-center">
        {handleKey !== undefined && (
          <p className="text-6xl sm:text-7xl mb-6 tracking-tight">
            <span role="img" aria-label={spoken ?? handleKey}>
              {handleKey}
            </span>
          </p>
        )}

        <h1 className="text-3xl font-bold text-slate-900 mb-3 tracking-tight">
          {wording.heading}
        </h1>

        {spoken !== undefined && (
          <p className="text-lg text-slate-500 mb-2">
            {format(copy.spoken, { spoken })}
          </p>
        )}

        <p className="text-lg text-slate-500">{wording.body}</p>

        {wording.stillHeld && (
          <p className="mt-4 inline-block rounded-xl bg-indigo-50 px-4 py-2 text-base font-medium text-indigo-700">
            {copy.holdNotice}
          </p>
        )}

        {wording.offersPick && (
          <p className="mt-8">
            <Link
              className="inline-block rounded-xl bg-indigo-600 px-5 py-3 text-base font-semibold text-white hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              href="/"
            >
              {copy.holdExpiredAction}
            </Link>
          </p>
        )}
      </div>

      {wording.offersResend && (
        <section
          aria-labelledby="resend-heading"
          className="mt-12 rounded-xl bg-white p-6 shadow-sm"
        >
          <h2
            className="text-xl font-semibold text-slate-900 mb-4"
            id="resend-heading"
          >
            {copy.resendHeading}
          </h2>

          <form action={resend} className="flex flex-col gap-3">
            {encoded !== undefined && (
              // So the answer comes back to this Handle's screen. It is the
              // public canonical segment, not anything about the person.
              <input name="handle" type="hidden" value={encoded} />
            )}
            {/* So the screen keeps saying what brought them here rather than
                resetting to "check your email" after a resend. */}
            <input name="reason" type="hidden" value={reason} />
            <label
              className="text-base font-medium text-slate-700"
              htmlFor="resend-email"
            >
              {copy.resendEmailLabel}
            </label>
            <input
              autoComplete="email"
              className="rounded-xl border border-slate-500 px-4 py-3 text-base text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              id="resend-email"
              name="email"
              required
              type="email"
            />
            <button
              className="self-start rounded-xl bg-indigo-600 px-5 py-3 text-base font-semibold text-white hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              type="submit"
            >
              {copy.resendSubmit}
            </button>
          </form>

          {/* Announced when it appears, because the answer arrives as a fresh
              render and a sighted user sees it while a screen-reader user would
              otherwise be told nothing at all. */}
          <p className="mt-4 text-base text-slate-600" role="status">
            {notice === undefined ? "" : noticeText(notice, retrySeconds)}
          </p>
        </section>
      )}
    </main>
  );
}
