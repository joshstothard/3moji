"use client";

import { useEffect, useId, useRef, useState } from "react";
import en from "../../../../packages/shared/messages/en.json";

const copy = en.HandlePage;

export interface ShareLinkControlProps {
  /**
   * The link to copy, built on the server by `lib/share-link.ts`: the site
   * origin, `/`, and the canonical word alias. This component never builds or
   * alters it, so what is shown, copied and selected is one string.
   */
  readonly href: string;
}

/** What the last press achieved. */
type CopyState = "idle" | "copied" | "manual";

/**
 * The control that copies a Handle's canonical word alias link
 * ([#160](https://github.com/joshstothard/3moji/issues/160), ADR-0008
 * decision 3).
 *
 * **The link is on screen as text before anything is pressed**, so a visitor
 * can read the alias — and a visitor whose browser offers no clipboard at all
 * still has something to select.
 *
 * **A real `<button>`, never disabled.** The keyboard path is the browser's
 * own, and a successful copy leaves focus exactly where it was: a control that
 * disables itself while it works drops focus to `<body>`, the lesson
 * `profile-form.tsx` records.
 *
 * **The outcome is announced through a `role="status"` region that is present
 * and empty from the first render.** A live region inserted at the moment it
 * has something to say is not observed in time to announce it.
 *
 * **When the Clipboard API is missing or refuses** — an insecure origin, a
 * denied permission, an older browser — the component says so rather than
 * claiming a copy, and shows the link in a labelled, read-only text field with
 * the whole link selected and **focus moved into it**. That is the one place
 * focus moves, deliberately: a selection in an unfocused field cannot be
 * copied, so leaving focus on the button would leave the visitor one step short
 * of the manual copy the message just offered them.
 */
export function ShareLinkControl({ href }: ShareLinkControlProps) {
  const [state, setState] = useState<CopyState>("idle");
  // Bumped on every failed press, so pressing again after a failure re-focuses
  // and re-selects the field even though the state is already `manual`.
  const [failures, setFailures] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const linkId = useId();
  const labelId = useId();
  const fieldId = useId();

  useEffect(() => {
    if (state !== "manual") return;
    field.current?.focus();
    field.current?.select();
  }, [state, failures]);

  function fail(): void {
    setState("manual");
    setFailures((count) => count + 1);
  }

  async function copyLink(): Promise<void> {
    try {
      // Inside the `try` on purpose, property access included:
      // `navigator.clipboard` is missing on an insecure origin and in older
      // browsers, whatever the DOM typings say, and reading `writeText` off it
      // then throws — which is the same answer as a refusal.
      await navigator.clipboard.writeText(href);
      setState("copied");
    } catch {
      fail();
    }
  }

  const announcement =
    state === "copied"
      ? copy.shareCopied
      : state === "manual"
        ? copy.shareManual
        : "";

  return (
    <section aria-labelledby={labelId} className="mt-8">
      {/* The region's name. The brand's dark pill needs no visible heading:
          the link and the button say what it is (#251). */}
      <p id={labelId} className="sr-only">
        {copy.shareHeading}
      </p>
      <div className="flex flex-col gap-3 rounded-card-lg bg-ink p-3 sm:flex-row sm:items-center sm:rounded-full sm:py-2 sm:pr-2 sm:pl-5">
        {/* 12.23:1 on ink. */}
        <p
          id={linkId}
          className="min-w-0 flex-1 px-2 font-mono text-[15px] break-all text-ink-soft sm:px-0"
        >
          {href}
        </p>
        <button
          type="button"
          aria-describedby={linkId}
          onClick={() => {
            void copyLink();
          }}
          // A white focus ring: violet is 2.92:1 on the ink around it.
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-violet px-[18px] text-[15px] font-semibold text-white hover:bg-violet-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <svg
            aria-hidden="true"
            className="size-4"
            fill="none"
            focusable="false"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <rect height="11" rx="2" width="11" x="9" y="9" />
            <path d="M5 15V6a2 2 0 0 1 2-2h9" />
          </svg>
          {copy.shareCopy}
        </button>
      </div>
      {state === "manual" && (
        <div className="mt-4 text-left">
          <label
            htmlFor={fieldId}
            className="block text-sm font-medium text-ink"
          >
            {copy.shareManualLabel}
          </label>
          <input
            ref={field}
            id={fieldId}
            type="text"
            readOnly
            value={href}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
            className="mt-1 block w-full rounded-2xl border border-control bg-card px-4 py-3 font-mono text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet"
          />
        </div>
      )}
      <p
        role="status"
        aria-live="polite"
        className="mt-3 text-center text-sm text-body"
      >
        {announcement}
      </p>
    </section>
  );
}
