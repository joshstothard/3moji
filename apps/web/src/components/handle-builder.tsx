"use client";

import { useEffect, useState } from "react";
import {
  canonicalise,
  findCuratedEmoji,
  HANDLE_LENGTH,
  spokenHandle,
} from "@template/core/browser";
import { EmojiPicker } from "./emoji-picker";
import type { AvailabilityState } from "./availability-state";
import en from "../../../../packages/shared/messages/en.json";

/**
 * The home page's Handle builder: three slots, the spoken tagline, the live URL
 * preview, and what the table says about the finished Handle.
 *
 * **The domain is imported, not reimplemented.** `spokenHandle` owns the
 * run-collapsing rules that make 🧊🍕🧊 read "an ice cube, a pizza and an ice
 * cube" rather than "two ice cubes and a pizza"
 * ([ADR-0004](../../../../docs/adr/0004-the-handle-model.md): a Handle is
 * ordered), and `canonicalise` owns the key and the percent-encoded path. Both
 * arrive through `@template/core/browser`, the entry point that exists because
 * the root one reaches `pg` and so cannot be bundled for a browser.
 *
 * **The availability read is injected as a prop.** It is a server action — it
 * needs the `handle` table, and `lib/services.ts` reads five environment
 * variables to get there — so the one collaborator that leaves the browser is
 * passed in by the page rather than reached for, and a test substitutes a fake
 * (`docs/development/engineering-standards.md` § The composition root).
 *
 * **Every control is permanent, and that is the accessibility requirement, not
 * a styling choice.** Each slot is one button for the life of the page: filling
 * it changes its label, and clearing it changes the label back. The prototype
 * swapped the control instead, which unmounted the focused node and dropped
 * focus to `<body>` — the regression #78 asks to be pinned down.
 */
interface HandleBuilderProps {
  readonly checkAvailability: (segment: string) => Promise<AvailabilityState>;
}

/** What is being shown on the availability line. */
type AvailabilityView = AvailabilityState | "checking";

const copy = en.HandleBuilder;

/**
 * One line per answer, and a `Record` over the union rather than a `switch`, so
 * a sixth state cannot be added to the domain without this failing to compile.
 * The copy is deliberately flat: the taken and held states get their real
 * treatment, with swap suggestions, in
 * [#80](https://github.com/joshstothard/3moji/issues/80).
 */
const AVAILABILITY_COPY: Readonly<Record<AvailabilityView, string>> = {
  checking: copy.checking,
  available: copy.stateAvailable,
  held: copy.stateHeld,
  claimed: copy.stateClaimed,
  "not-claimable": copy.stateNotClaimable,
  "not-a-handle": copy.stateNotAHandle,
  unknown: copy.stateUnknown,
};

const EMPTY_SLOTS: readonly (string | undefined)[] = Array.from(
  { length: HANDLE_LENGTH },
  () => undefined,
);

function format(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, value),
    template,
  );
}

/** The curated display name of an emoji, or the glyph if it has none. */
function nameOf(emoji: string): string {
  return findCuratedEmoji(emoji)?.displayName ?? emoji;
}

function isFilled(slot: string | undefined): slot is string {
  return slot !== undefined;
}

/**
 * The path segment to ask the server about: the canonical percent-encoded form,
 * exactly what `/[handle]` would receive for this Handle. `undefined` until all
 * three slots are filled — nothing is asked, and nothing irreversible offered,
 * before then.
 */
function segmentOf(filled: readonly string[]): string | undefined {
  if (filled.length !== HANDLE_LENGTH) {
    return undefined;
  }
  const result = canonicalise(filled.join(""));
  return result.ok ? result.encoded : undefined;
}

export function HandleBuilder({ checkAvailability }: HandleBuilderProps) {
  const [slots, setSlots] =
    useState<readonly (string | undefined)[]>(EMPTY_SLOTS);
  /**
   * The last answer received, **with the Handle it answers about**.
   *
   * Keying it that way is what makes a stale verdict impossible to render: the
   * view below compares the two rather than an effect clearing the state on
   * every change, which is both a cascading render and, per
   * `react-hooks/set-state-in-effect`, the wrong shape for derived state.
   */
  const [answer, setAnswer] = useState<
    { readonly segment: string; readonly state: AvailabilityState } | undefined
  >(undefined);

  const filled = slots.filter(isFilled);
  const path = filled.join("");
  const spoken = spokenHandle(filled);
  const segment = segmentOf(filled);
  const full = filled.length === HANDLE_LENGTH;

  useEffect(() => {
    if (segment === undefined) {
      return;
    }

    // `current` is not belt-and-braces over the segment comparison below: it is
    // what stops an earlier read that resolves late from replacing a newer
    // answer, which the comparison alone would then read as "still checking".
    let current = true;
    void checkAvailability(segment).then(
      (state) => {
        if (current) setAnswer({ segment, state });
      },
      () => {
        // The action already answers "unknown" for a failed read; this covers
        // the transport itself failing, which must not surface as an unhandled
        // rejection on the page.
        if (current) setAnswer({ segment, state: "unknown" });
      },
    );

    return () => {
      current = false;
    };
  }, [segment, checkAvailability]);

  const availability: AvailabilityView | undefined =
    segment === undefined
      ? undefined
      : answer?.segment === segment
        ? answer.state
        : "checking";

  function fill(emoji: string) {
    setSlots((current) => {
      const next = [...current];
      const index = next.findIndex((slot) => slot === undefined);
      if (index === -1) {
        return current;
      }
      next[index] = emoji;
      return next;
    });
  }

  function clear(index: number) {
    setSlots((current) => {
      const next = [...current];
      next[index] = undefined;
      return next;
    });
  }

  return (
    <>
      <section aria-labelledby="handle-builder-heading" className="mt-12">
        <h2
          id="handle-builder-heading"
          className="text-sm font-semibold text-slate-900 uppercase tracking-wide text-center"
        >
          {copy.builderHeading}
        </h2>

        <div
          role="group"
          aria-label={copy.slotsLabel}
          className="mt-4 flex justify-center gap-3"
        >
          {slots.map((emoji, index) => (
            // The index is the key on purpose: a slot is a fixed position, not
            // a list entry that moves, and keying by content would remount the
            // button — the focus loss this component exists to avoid.
            <button
              key={index}
              type="button"
              aria-disabled={emoji === undefined}
              aria-label={
                emoji === undefined
                  ? format(copy.slotEmpty, {
                      position: String(index + 1),
                    })
                  : format(copy.slotFilled, {
                      position: String(index + 1),
                      name: nameOf(emoji),
                    })
              }
              onClick={() => {
                if (emoji !== undefined) {
                  clear(index);
                }
              }}
              className="w-20 h-20 text-4xl leading-none flex items-center justify-center rounded-xl bg-white border border-slate-200 shadow-sm hover:border-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 aria-disabled:border-dashed aria-disabled:hover:border-slate-200"
            >
              <span aria-hidden="true">{emoji ?? ""}</span>
            </button>
          ))}
        </div>

        <p
          aria-live="polite"
          className="mt-6 text-center text-lg text-slate-900"
        >
          {spoken === undefined
            ? copy.spokenEmpty
            : format(copy.spoken, { spoken })}
        </p>

        <p className="mt-2 text-center text-sm text-slate-500">
          <span className="sr-only">{copy.urlLabel}</span>
          <span className="font-mono">{copy.urlHost}</span>
          {path === "" ? null : (
            <span className="font-mono" role="img" aria-label={spoken ?? path}>
              {path}
            </span>
          )}
        </p>

        <p
          aria-live="polite"
          className="mt-6 text-center text-sm font-medium text-indigo-600 min-h-5"
        >
          {availability === undefined ? "" : AVAILABILITY_COPY[availability]}
        </p>
      </section>

      <EmojiPicker onPick={fill} full={full} />
    </>
  );
}
