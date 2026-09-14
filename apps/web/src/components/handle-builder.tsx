"use client";

import { useEffect, useRef, useState } from "react";
import {
  canonicalise,
  HANDLE_LENGTH,
  spokenHandle,
  swapSuggestions,
  type SwapSuggestion,
} from "@template/core/browser";
import { EmojiPicker } from "./emoji-picker";
import { HandleSlot } from "./handle-slot";
import type { AvailabilityState } from "./availability-state";
import { ClaimForm, type SubmitClaim } from "./claim-form";
import en from "../../../../packages/shared/messages/en.json";

/**
 * The Handle builder: three slots, the spoken tagline, the live URL preview,
 * and what the table says about the finished Handle.
 *
 * **Two surfaces, one builder.** The home page renders it empty, and
 * `/[handle]` renders it pre-filled when the Handle is unclaimed — the same
 * component with `initialEmoji` supplied, because a second builder would drift
 * from this one and take the focus behaviour below with it.
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
  /**
   * Emoji to start with, in order — what `/[handle]` hands over when an
   * unclaimed Handle renders the builder rather than a dead end
   * ([#105](https://github.com/joshstothard/3moji/issues/105)). Somebody who
   * typed a Handle into the address bar has already made the pick, so the
   * builder opens on it.
   *
   * The home page passes nothing and starts empty. This is the whole of the
   * difference between the two surfaces: one optional prop rather than a second
   * builder, which would have drifted from this one within a week.
   */
  readonly initialEmoji?: readonly string[];
  /**
   * The claim endpoint, injected for the reason `checkAvailability` is
   * ([#115](https://github.com/joshstothard/3moji/issues/115)). When it is
   * given, the claim form is offered **only while the Handle in the slots reads
   * as available** — never for taken, held, reserved or `unknown`, the last of
   * which means the read failed and cannot know the Handle is free (#68).
   * Absent, the builder offers nothing irreversible at all.
   */
  readonly claim?: SubmitClaim;
  /**
   * What the page has already read about `initialEmoji`, so the first paint
   * need not wait for the same read again. `/[handle]` renders the builder only
   * because its read answered `available`, and its call to action links to the
   * claim form; without this the link would point at nothing until the
   * builder's own read came back. The builder still asks on mount, and its
   * answer replaces this one.
   */
  readonly initialAvailability?: AvailabilityState | undefined;
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

/**
 * The slots a render starts on: the given emoji, one per position, padded to
 * {@link HANDLE_LENGTH} and truncated to it, so an over- or under-long argument
 * cannot produce a fourth slot or a missing one.
 */
function initialSlots(
  initialEmoji: readonly string[] | undefined,
): readonly (string | undefined)[] {
  if (initialEmoji === undefined) {
    return EMPTY_SLOTS;
  }
  return Array.from(
    { length: HANDLE_LENGTH },
    (_unused, index) => initialEmoji[index],
  );
}

/** The answer a render starts on: the page's own read, about the page's Handle. */
function initialAnswer(
  initialEmoji: readonly string[] | undefined,
  initialAvailability: AvailabilityState | undefined,
): { readonly segment: string; readonly state: AvailabilityState } | undefined {
  if (initialAvailability === undefined) {
    return undefined;
  }
  const segment = segmentOf(initialSlots(initialEmoji).filter(isFilled));
  return segment === undefined
    ? undefined
    : { segment, state: initialAvailability };
}

export function HandleBuilder({
  checkAvailability,
  initialEmoji,
  claim,
  initialAvailability,
}: HandleBuilderProps) {
  // A lazy initialiser, and deliberately: the slots are this component's state
  // from the first render on, so a later render with the same prop must not
  // throw away what the visitor has picked since.
  const [slots, setSlots] = useState<readonly (string | undefined)[]>(() =>
    initialSlots(initialEmoji),
  );
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
  >(() => initialAnswer(initialEmoji, initialAvailability));

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
   * A rare find: three of the same emoji, and free
   * ([#202](https://github.com/joshstothard/3moji/issues/202)).
   * Three-of-a-kind Handles stay claimable rather than reserved, and finding an
   * available one is celebrated.
   *
   * **Derived only from what the builder already shows**, and that is the
   * privacy property rather than a convenience. The slots are on screen and the
   * availability line already reads "available", so the celebration can say
   * nothing the page does not: it never appears for a taken, held, reserved or
   * unknown triple, and never while the answer is still being checked, so it
   * cannot distinguish one refusal from another or arrive ahead of the answer.
   */
  const rare =
    availability === "available" &&
    full &&
    filled.every((each) => each === filled[0]);

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
      <section
        aria-labelledby="handle-builder-heading"
        className="mt-12 rounded-card border border-line bg-card p-5 shadow-card sm:rounded-card-lg sm:p-10"
      >
        <h2
          id="handle-builder-heading"
          className="scroll-mt-28 text-[13px] font-semibold text-muted uppercase tracking-[0.08em]"
        >
          {copy.builderHeading}
        </h2>

        <div
          role="group"
          aria-label={copy.slotsLabel}
          className="mt-5 grid grid-cols-3 gap-2.5 sm:gap-4"
        >
          {slots.map((emoji, index) => (
            // The index is the key on purpose: a slot is a fixed position, not
            // a list entry that moves, and keying by content would remount the
            // button — the focus loss this component exists to avoid.
            <HandleSlot
              key={index}
              ref={(node) => {
                if (node === null) {
                  slotControls.current.delete(index);
                } else {
                  slotControls.current.set(index, node);
                }
              }}
              position={index + 1}
              emoji={emoji}
              rare={rare}
              onClear={() => {
                clear(index);
              }}
            />
          ))}
        </div>

        <p
          aria-live="polite"
          className="mt-6 font-display text-xl leading-tight font-bold tracking-[-0.02em] text-ink sm:text-[28px]"
        >
          {spoken === undefined
            ? copy.spokenEmpty
            : format(copy.spoken, { spoken })}
        </p>

        <p className="mt-1.5 text-sm text-muted sm:text-[15px]">
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
          className="mt-5 text-sm font-medium text-violet min-h-5"
        >
          {availability === undefined ? "" : AVAILABILITY_COPY[availability]}
        </p>

        {/* The rarity's one announcement. The region is permanent, because a
            live region inserted together with its text is not reliably read,
            and React leaves its text alone on any render that keeps the
            Handle rare, so it is not read again. It moves no focus. */}
        <p aria-live="polite" data-rare-announcement="" className="sr-only">
          {rare ? copy.rareAnnouncement : ""}
        </p>

        {rare ? (
          // Hidden from assistive technology, which has the sentence above;
          // keyed on the Handle so a new rare triple plays the pop afresh.
          <div key={segment} aria-hidden="true" className="mt-3 flex">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sunshine px-3 py-1 text-sm font-semibold text-ink motion-safe:animate-rare-pop">
              <span>{"✨"}</span>
              <span>{copy.rareBadge}</span>
            </span>
          </div>
        ) : null}

        {suggestions.length === 0 ? null : (
          <div className="mt-6">
            <h3 id="handle-swaps-heading" className="text-sm text-muted">
              {copy.swapHeading}
            </h3>
            <div
              role="group"
              aria-labelledby="handle-swaps-heading"
              className="mt-3 flex flex-wrap gap-3"
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
                  className="px-4 h-12 text-2xl leading-none flex items-center justify-center rounded-full bg-card border border-control hover:border-violet focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet"
                >
                  <span aria-hidden="true">{suggestion.handle.key}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {claim !== undefined &&
      segment !== undefined &&
      availability === "available" ? (
        // Keyed on the Handle, so a rejection said about one Handle is never
        // left on screen under another. `segment` is the one in the slots now,
        // not the one the page opened on.
        <ClaimForm key={segment} claim={claim} handle={segment} />
      ) : null}

      <EmojiPicker onPick={fill} full={full} />
    </>
  );
}
