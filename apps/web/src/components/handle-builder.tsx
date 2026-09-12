"use client";

import { useEffect, useRef, useState } from "react";
import {
  canonicalise,
  findCuratedEmoji,
  HANDLE_LENGTH,
  spokenHandle,
  swapSuggestions,
  type SwapSuggestion,
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
 *
 * Two of them say deliberately little. **Held names no holder and no expiry**
 * ([ADR-0004](../../../../docs/adr/0004-the-handle-model.md): a countdown is an
 * information leak and an invitation to wait), and **reserved does not say
 * why** — naming the block would be a hint to go looking for the list. Neither
 * is a matter of restraint in the JSX: the answer arriving from the server is a
 * state name, so the expiry and the `Reservation` carrying the reason never
 * cross into the browser at all.
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

/**
 * How a whole Handle is said, or its glyphs if the domain has no form for it.
 * `spokenHandle` owns the run-collapsing rules, so a suggestion reads "two
 * pizzas and some grapes" rather than three names in a row.
 */
function spokenOf(entries: readonly { readonly emoji: string }[]): string {
  const emoji = entries.map((entry) => entry.emoji);
  return spokenHandle(emoji) ?? emoji.join("");
}

/** The curated display name of an emoji, or the glyph if it has none. */
function nameOf(emoji: string): string {
  return findCuratedEmoji(emoji)?.displayName ?? emoji;
}

function isFilled(slot: string | undefined): slot is string {
  return slot !== undefined;
}

/**
 * The answers a visitor cannot have the Handle under, and is therefore owed
 * something better than a dead end.
 *
 * `unknown` is not one of them: it means the read failed, not that the Handle
 * is gone, and suggesting swaps away from a Handle that may well be free would
 * be its own small lie.
 */
const UNAVAILABLE: readonly AvailabilityView[] = [
  "claimed",
  "held",
  "not-claimable",
];

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
   * The slot controls, so applying a swap can put focus on the slot that
   * changed.
   *
   * A suggestion button disappears the moment it is used — the Handle is no
   * longer the taken one — and an unmounted focused node drops focus to
   * `<body>`, the regression this component's permanent controls exist to
   * avoid. Moving focus deliberately, to a control that is never unmounted, is
   * the fix; leaving it to React is how focus gets lost.
   */
  const slotControls = useRef(new Map<number, HTMLButtonElement>());
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

  /**
   * Derived, not stored: the suggestions are a pure function of the pick and
   * the answer about it, so there is no second piece of state to fall out of
   * step with the first. `swapSuggestions` is domain — same group, never
   * Reserved, deterministic — and it promises "well-formed and not Reserved",
   * not "free": proving free would be one database read per suggestion.
   */
  const suggestions =
    availability !== undefined && UNAVAILABLE.includes(availability)
      ? swapSuggestions({ emoji: filled })
      : [];

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

  /**
   * Take a suggestion: the whole Handle is replaced, because a suggestion is a
   * Handle rather than an emoji, and focus follows the emoji that changed.
   */
  function applySwap({ handle, position }: SwapSuggestion) {
    setSlots(handle.emoji.map((entry) => entry.emoji));
    // The slot is a permanent control, already in the document, so this lands
    // before the suggestion that had focus is unmounted.
    slotControls.current.get(position)?.focus();
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
              ref={(node) => {
                if (node === null) {
                  slotControls.current.delete(index);
                } else {
                  slotControls.current.set(index, node);
                }
              }}
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

        {suggestions.length === 0 ? null : (
          <div className="mt-6">
            <h3
              id="handle-swaps-heading"
              className="text-center text-sm text-slate-500"
            >
              {copy.swapHeading}
            </h3>
            <div
              role="group"
              aria-labelledby="handle-swaps-heading"
              className="mt-3 flex justify-center gap-3"
            >
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.handle.key}
                  type="button"
                  aria-label={format(copy.swapSuggestion, {
                    spoken: spokenOf(suggestion.handle.emoji),
                  })}
                  onClick={() => {
                    applySwap(suggestion);
                  }}
                  className="px-3 h-12 text-2xl leading-none flex items-center justify-center rounded-xl bg-white border border-slate-200 shadow-sm hover:border-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                >
                  <span aria-hidden="true">{suggestion.handle.key}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <EmojiPicker onPick={fill} full={full} />
    </>
  );
}
