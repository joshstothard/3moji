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
    <section
      aria-labelledby={labelId}
      className="mt-10 rounded-xl bg-white px-5 py-4 text-center shadow-sm"
    >
      <p id={labelId} className="text-base font-semibold text-slate-900">
        {copy.shareHeading}
      </p>
      <p id={linkId} className="mt-2 break-all font-mono text-slate-700">
        {href}
      </p>
      <button
        type="button"
        aria-describedby={linkId}
        onClick={() => {
          void copyLink();
        }}
        className="mt-3 rounded-xl bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        {copy.shareCopy}
      </button>
      {state === "manual" && (
        <div className="mt-4 text-left">
          <label
            htmlFor={fieldId}
            className="block text-sm font-medium text-slate-900"
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
            className="mt-1 block w-full rounded-xl border border-slate-500 px-3 py-2 font-mono text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          />
        </div>
      )}
      <p
        role="status"
        aria-live="polite"
        className="mt-3 text-sm text-slate-600"
      >
        {announcement}
      </p>
    </section>
  );
}
