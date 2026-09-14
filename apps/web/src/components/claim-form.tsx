"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import type { ClaimFormState } from "./claim-action";
import { LinkedSentence } from "./linked-sentence";
import en from "../../../../packages/shared/messages/en.json";

const copy = en.Claim;

/** The claim endpoint, in the shape `useActionState` needs. Injected, so a test substitutes one. */
export type SubmitClaim = (
  previous: ClaimFormState,
  formData: FormData,
) => Promise<ClaimFormState>;

export interface ClaimFormProps {
  /** The percent-encoded canonical segment of the Handle being claimed. */
  readonly handle: string;
  readonly claim: SubmitClaim;
  /** A short line above the heading, such as the composer's "Step 2" (#263). */
  readonly eyebrow?: string | undefined;
  /**
   * Whether this form is the `#claim` the unclaimed Handle's call to action
   * links to. `true` by default. The phone's claim sheet passes `false`,
   * because step 2 in the page keeps that id while the sheet holds the form,
   * and a page must not have two (#272).
   */
  readonly anchor?: boolean;
}

type Rejection = Exclude<ClaimFormState["state"], "idle">;

/**
 * One sentence per rejection, as a `Record` over the union rather than a
 * `switch`, so a new rejection cannot be added to the action without this
 * failing to compile.
 *
 * **There is no entry for success, and there must never be one.** An accepted
 * Claim redirects to the hold screen from inside the action, for a new address
 * and an already-registered one alike, so nothing arrives here to render. A
 * client-side "check your email" would be a second success path — and the
 * second place the two could be told apart
 * ([#15](https://github.com/joshstothard/3moji/issues/15)).
 *
 * **`taken` is one sentence whatever its `because`.** Whether the Handle is
 * held or claimed — or was lost to a race a moment ago — is who-and-when
 * information ADR-0004 keeps off every page; the builder's own line says only
 * "taken" or "on hold" about a Handle the visitor has not tried to claim.
 */
const REJECTION_COPY: Readonly<Record<Rejection, string>> = {
  taken: copy.claimTaken,
  "not-claimable": copy.claimNotClaimable,
  "not-a-handle": copy.claimNotAHandle,
  invalid: copy.claimInvalid,
  // One sentence for both limits, and no "try again in": which limit bound is
  // exactly what it must not say (#157).
  "rate-limited": copy.claimRateLimited,
  failed: copy.claimFailed,
};

const IDLE: ClaimFormState = { state: "idle" };

/**
 * The id the unclaimed-Handle page's call to action links to. Repeated there
 * as a literal rather than imported: an export of a `"use client"` module
 * reaches a server component as a client reference, not as a string.
 */
const SECTION_ID = "claim";
const HEADING_ID = "claim-heading";
const MESSAGE_ID = "claim-message";

/** The privacy and terms links in the sentence under the email field. */
const LEGAL_LINK =
  "font-medium text-violet underline hover:text-violet-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet";

const FIELD =
  "rounded-2xl border border-control px-4 py-3 text-base text-ink aria-invalid:border-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet";

/**
 * The claim form: an email address and a password, for the Handle in the
 * builder's slots ([#115](https://github.com/joshstothard/3moji/issues/115)).
 *
 * A thin client over `submitClaimAction`, which is where every rule lives. It
 * decides nothing about the Claim; it renders the answer.
 *
 * **It needs JavaScript, where sign-in and resend do not.** The Handle lives in
 * the builder's client state, so there is no server render of this form to
 * fall back to — and `useActionState` is the repo's idiom for an action that
 * answers with a state (`profile-form.tsx`).
 *
 * **The password is only ever in the POST body.** The input is uncontrolled,
 * so the value lives in the DOM node and never in React state or a `value`
 * attribute; it is cleared after every rejection rather than echoed back; and
 * the form has no `method` — a server action posts.
 *
 * **Every rejection is announced, and blames only what is at fault.** The
 * alert region is present and empty from the first render, because a live
 * region added at the moment it has something to say is not observed in time
 * to announce it. `invalid` is the one answer about the fields, so it alone
 * marks them `aria-invalid`, describes them by the message and moves focus to
 * the first; the others are about the Handle, or about nothing the visitor did,
 * and describe the submit button instead — marking the email invalid for "this
 * Handle is taken" would send a screen reader user to fix the wrong thing.
 */
export function ClaimForm({
  handle,
  claim,
  eyebrow,
  anchor = true,
}: ClaimFormProps) {
  const [state, formAction] = useActionState(claim, IDLE);
  /**
   * The email is kept across a rejection, so nobody retypes it to try another
   * Handle. It is an address the visitor typed a moment ago, not a secret.
   */
  const [email, setEmail] = useState("");
  const emailField = useRef<HTMLInputElement>(null);
  const passwordField = useRef<HTMLInputElement>(null);

  const message = state.state === "idle" ? "" : REJECTION_COPY[state.state];
  const fieldsAtFault = state.state === "invalid";

  useEffect(() => {
    if (state.state === "idle") return;

    // React resets an uncontrolled field after a form action; clearing it here
    // as well means the password never outlives a rejection even if it ever
    // stops doing so.
    if (passwordField.current !== null) {
      passwordField.current.value = "";
    }
    if (state.state === "invalid") {
      emailField.current?.focus();
    }
  }, [state]);

  return (
    <section
      aria-labelledby={HEADING_ID}
      className="md:grid md:grid-cols-[15rem_minmax(0,1fr)] md:items-start md:gap-x-10"
      id={anchor ? SECTION_ID : undefined}
    >
      <div>
        {eyebrow === undefined ? null : (
          <p className="mb-1.5 text-xs font-semibold tracking-[0.08em] text-muted uppercase">
            {eyebrow}
          </p>
        )}
        <h2
          className="mb-2 font-display text-2xl leading-tight font-bold tracking-[-0.02em] text-ink"
          id={HEADING_ID}
        >
          {copy.claimHeading}
        </h2>
        <p className="mb-5 text-[15px] text-body md:mb-0">{copy.claimBody}</p>
      </div>

      <form
        action={formAction}
        aria-labelledby={HEADING_ID}
        className="flex flex-col gap-4 md:grid md:grid-cols-2 md:items-start md:gap-x-5"
      >
        {/* The public canonical segment of the Handle, not anything about the
            person. The action canonicalises it again; nothing here is trusted. */}
        <input name="handle" type="hidden" value={handle} />

        <div className="flex flex-col gap-2">
          <label
            className="text-base font-medium text-body"
            htmlFor="claim-email"
          >
            {copy.claimEmailLabel}
          </label>
          <input
            aria-describedby={fieldsAtFault ? MESSAGE_ID : undefined}
            aria-invalid={fieldsAtFault ? true : undefined}
            autoComplete="email"
            className={FIELD}
            id="claim-email"
            name="email"
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            ref={emailField}
            required
            type="email"
            value={email}
          />
          {/* Before submission, beside the address it is about (#198). In a
              new tab, because the Handle lives in this page's client state and
              following a link in place would lose it. */}
          <p className="text-sm leading-6 text-body">
            <LinkedSentence
              links={{
                privacy: (
                  <a
                    className={LEGAL_LINK}
                    href="/privacy"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {copy.claimPrivacyLink}
                  </a>
                ),
                terms: (
                  <a
                    className={LEGAL_LINK}
                    href="/terms"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {copy.claimTermsLink}
                  </a>
                ),
              }}
              text={copy.claimLegalNote}
            />
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label
            className="text-base font-medium text-body"
            htmlFor="claim-password"
          >
            {copy.claimPasswordLabel}
          </label>
          <input
            aria-describedby={fieldsAtFault ? MESSAGE_ID : undefined}
            aria-invalid={fieldsAtFault ? true : undefined}
            autoComplete="new-password"
            className={FIELD}
            id="claim-password"
            name="password"
            ref={passwordField}
            required
            type="password"
          />
        </div>

        <p
          className="min-h-6 text-base font-medium text-red-800 md:col-span-2"
          id={MESSAGE_ID}
          role="alert"
        >
          {message}
        </p>

        <button
          aria-describedby={
            message !== "" && !fieldsAtFault ? MESSAGE_ID : undefined
          }
          className="self-stretch rounded-full bg-violet px-5 py-3 text-base font-semibold text-white hover:bg-violet-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet md:col-span-2 md:justify-self-start"
          type="submit"
        >
          {copy.claimSubmit}
        </button>
      </form>
    </section>
  );
}
