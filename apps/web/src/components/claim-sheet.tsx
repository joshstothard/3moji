"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import en from "../../../../packages/shared/messages/en.json";

const copy = en.HandleBuilder;

/** What Tab can land on inside the sheet. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ClaimSheetProps {
  /** Whether the sheet is showing. The builder owns this; the sheet obeys it. */
  readonly open: boolean;
  /** The id of the heading that names the dialog. */
  readonly labelledBy: string;
  /** The row beside the close control: what the sheet is about. */
  readonly header: ReactNode;
  /** Escape, the close control or the backdrop: the visitor wants it gone. */
  readonly onDismiss: () => void;
  readonly children: ReactNode;
}

/**
 * The phone's claim sheet: a bottom sheet over the builder
 * ([#263](https://github.com/joshstothard/3moji/issues/263)).
 *
 * **A native `<dialog>`, opened with `showModal()`.** That is what puts it in
 * the top layer and makes everything else on the page inert, so a screen
 * reader's virtual cursor and a pointer cannot reach the page behind it. The
 * builder also marks its own card `inert` while the sheet is open, so the
 * card's slots are out of the accessibility tree even where a browser's modal
 * handling is incomplete, and a unit test can see it.
 *
 * **Focus moves in, and stays in.** Opening puts focus on the close control,
 * the first thing in the sheet, rather than on the email field, which would
 * raise a phone's keyboard before the visitor has read what the sheet is.
 * Tab and Shift+Tab wrap at the ends: a modal dialog already keeps focus off
 * the page, but a browser may send it out to its own toolbar, and a keyboard
 * user should not have to find their way back.
 *
 * **Every way out goes through `onDismiss`.** Escape is handled on `keydown`,
 * so the browser's own `cancel` never races it, and a `close` the browser
 * fires by itself is reported too. The builder decides where focus goes after,
 * because only it knows which slot the visitor left from.
 *
 * It holds no state and knows nothing about Handles: what it shows is the
 * builder's, passed in as `header` and `children`, so there is one source of
 * truth for every view of the Handle.
 */
export function ClaimSheet({
  open,
  labelledBy,
  header,
  onDismiss,
  children,
}: ClaimSheetProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeControl = useRef<HTMLButtonElement>(null);
  /** Whether the builder still wants the sheet open, for the `close` event. */
  const wanted = useRef(open);
  /** The latest `onDismiss`, for the listeners attached once below. */
  const dismiss = useRef(onDismiss);

  useEffect(() => {
    dismiss.current = onDismiss;
  });

  useEffect(() => {
    wanted.current = open;
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) {
      element.showModal();
      closeControl.current?.focus();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  // Escape, the focus wrap and the backdrop click are native listeners on the
  // dialog rather than JSX handlers: they belong to the dialog as a whole, and
  // a `<dialog>` is not an interactive element for `jsx-a11y` to hang them on.
  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss.current();
        return;
      }
      if (event.key !== "Tab" || element === null) return;

      const controls = Array.from(
        element.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (first === undefined || last === undefined) return;

      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === element)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function onClick(event: MouseEvent) {
      // The sheet's content fills the dialog box, so a click whose target is
      // the dialog itself landed on the backdrop around it.
      if (event.target === element) dismiss.current();
    }

    element.addEventListener("keydown", onKeyDown);
    element.addEventListener("click", onClick);
    return () => {
      element.removeEventListener("keydown", onKeyDown);
      element.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      onClose={() => {
        if (wanted.current) onDismiss();
      }}
      className="fixed inset-x-0 top-auto bottom-0 m-0 max-h-[92dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-[28px] border-0 bg-card p-0 text-ink shadow-[0_-20px_40px_-20px_rgb(26_21_35/0.35)] backdrop:bg-ink/30 motion-safe:animate-sheet-up"
    >
      {open ? (
        <div className="flex flex-col gap-4 px-5 pt-2.5 pb-[max(1.75rem,env(safe-area-inset-bottom))]">
          <div
            aria-hidden="true"
            className="mx-auto h-1.5 w-10 rounded-full bg-line"
          />
          <div className="flex min-h-11 items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
              {header}
            </div>
            <button
              ref={closeControl}
              type="button"
              aria-label={copy.sheetClose}
              onClick={onDismiss}
              className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                className="size-5"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
