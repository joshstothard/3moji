"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import { ClaimSheet } from "./claim-sheet";
import en from "../../../../packages/shared/messages/en.json";

/**
 * Below Tailwind's `md` (48rem) the builder takes its phone layout (#263). The
 * `.99` keeps a 768px screen on the wide side, where `md:` classes apply.
 */
const PHONE_QUERY = "(max-width: 47.99rem)";

function subscribeToPhone(onChange: () => void): () => void {
  if (!("matchMedia" in window)) {
    return () => undefined;
  }
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
  };
}

function isPhone(): boolean {
  return "matchMedia" in window && window.matchMedia(PHONE_QUERY).matches;
}

/** The server cannot see the screen, so it renders the layout that needs no script. */
function onTheServer(): boolean {
  return false;
}

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

  /**
   * Whether the page is laid out for a phone
   * ([#263](https://github.com/joshstothard/3moji/issues/263)), which is what
   * turns the inline claim form into the claim sheet.
   *
   * **The server always says no**, and so does the first render in the browser,
   * which has to match the HTML it hydrates. So without JavaScript, and until
   * the page has hydrated, the claim form is inline in step 2 on every width.
   * The sheet is an enhancement layered on a page that already works.
   */
  const phone = useSyncExternalStore(subscribeToPhone, isPhone, onTheServer);
  /**
   * The Handle whose sheet the visitor closed, so the sheet does not spring
   * open again over the grid for the same Handle. A control in the page opens
   * it again.
   */
  const [dismissed, setDismissed] = useState<string | undefined>(undefined);
  /**
   * The bar slot that takes focus when the sheet closes: the last one, unless
   * an emoji was removed from the sheet, in which case the slot it was in.
   */
  const returnFocusTo = useRef(HANDLE_LENGTH - 1);
  const sheetWasOpen = useRef(false);

  const claimable =
    claim !== undefined &&
    segment !== undefined &&
    availability === "available";
  const sheetMode = phone && claim !== undefined;
  const sheetOpen = sheetMode && claimable && dismissed !== segment;
  const offerReopen = sheetMode && claimable && !sheetOpen;

  useEffect(() => {
    // After the sheet's own effect has closed the dialog and the card has lost
    // `inert`, so the slot can take focus. Focus never falls to `<body>`.
    if (sheetWasOpen.current && !sheetOpen) {
      slotControls.current.get(returnFocusTo.current)?.focus();
      returnFocusTo.current = HANDLE_LENGTH - 1;
    }
    sheetWasOpen.current = sheetOpen;
  }, [sheetOpen]);

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

  function dismissSheet() {
    if (segment !== undefined) {
      setDismissed(segment);
    }
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

  const spokenLine =
    spoken === undefined ? copy.spokenEmpty : format(copy.spoken, { spoken });
  const nextSlot = slots.findIndex((slot) => slot === undefined);
  const progress =
    filled.length === 1
      ? copy.pickTwoMore
      : filled.length === 2
        ? copy.pickOneMore
        : undefined;
  const url = (
    <>
      <span className="sr-only">{copy.urlLabel}</span>
      <span>{copy.urlHost}</span>
      {path === "" ? null : (
        <span role="img" aria-label={spoken ?? path}>
          {path}
        </span>
      )}
    </>
  );

  return (
    <>
      {/*
       * The composer (#263): one tree for every width, repositioned by CSS, so
       * there is one set of slots, one spoken line and one claim form to keep
       * in step. From `md` it is a card; below, its parts run edge to edge.
       * `inert` while the phone's sheet is open, which takes the card's own
       * slots out of the accessibility tree along with everything else in it.
       */}
      <section
        aria-labelledby="handle-builder-heading"
        data-composer=""
        inert={sheetOpen}
        className="mt-8 w-full md:mx-auto md:max-w-[1000px] md:rounded-[36px] md:border md:border-line md:bg-card md:shadow-card"
      >
        {/* The slot row. On a phone it is the Handle bar, sticky under the
            header (4rem, 5rem from `sm`) and 78px tall so the tabs below know
            where to stick; from `md` it sticks to the top of the viewport
            within the card, under the 5rem header. Each overlaps what is above
            it by a pixel, so no sliver of page shows between them. */}
        <div
          data-composer-bar=""
          className="sticky top-[calc(4rem-1px)] z-[6] bg-paper pt-3 pb-2.5 max-md:mx-[calc(50%-50vw)] max-md:px-4 sm:top-[calc(5rem-1px)] sm:max-md:px-8 md:top-20 md:rounded-t-[36px] md:border-b md:border-line md:bg-card md:px-10 md:py-8"
        >
          <div className="flex h-14 items-center gap-3 md:grid md:h-auto md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:gap-10 lg:grid-cols-[26.25rem_minmax(0,1fr)]">
            <div
              role="group"
              aria-label={copy.slotsLabel}
              className="grid shrink-0 grid-cols-[repeat(3,3.5rem)] gap-2 md:grid-cols-3 md:gap-3.5"
            >
              {slots.map((emoji, index) => (
                // The index is the key on purpose: a slot is a fixed position,
                // not a list entry that moves, and keying by content would
                // remount the button — the focus loss this component exists
                // to avoid.
                <HandleSlot
                  key={index}
                  ref={(node) => {
                    if (node === null) {
                      slotControls.current.delete(index);
                    } else {
                      slotControls.current.set(index, node);
                    }
                  }}
                  size="bar"
                  next={index === nextSlot}
                  position={index + 1}
                  emoji={emoji}
                  rare={rare}
                  onClear={() => {
                    clear(index);
                  }}
                />
              ))}
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-0.5 md:gap-2">
              <h2
                id="handle-builder-heading"
                className="scroll-mt-28 text-xs font-semibold tracking-[0.08em] text-muted uppercase max-md:sr-only"
              >
                {copy.builderHeading}
              </h2>
              <p
                aria-live="polite"
                className="line-clamp-2 font-display text-[15px] leading-tight font-bold tracking-[-0.01em] text-ink md:line-clamp-none md:text-[30px] md:leading-[1.1] md:tracking-[-0.02em]"
              >
                {spokenLine}
              </p>
              <p className="hidden font-mono text-sm text-muted md:block">
                {url}
              </p>
              <p className="min-h-4 text-xs font-medium md:min-h-5 md:text-sm">
                <span aria-live="polite" className="text-violet">
                  {availability === undefined
                    ? ""
                    : AVAILABILITY_COPY[availability]}
                </span>
                {progress === undefined ? null : (
                  <span className="text-muted">{progress}</span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Below the bar, every focus target keeps clear of the sticky header
            and bars when the browser scrolls it into view (WCAG 2.4.11): the
            header, the bar and the phone's tabs come to about 13rem (14rem from
            `sm`), and the header and the card's bar to under 20rem from `md`.
            On a phone the reopen button is fixed at the bottom, so the bottom
            keeps clear too. */}
        <div className="**:scroll-mt-52 sm:**:scroll-mt-56 md:**:scroll-mt-80 max-md:**:scroll-mb-24">
          {/* The rarity's one announcement. The region is permanent, because a
              live region inserted together with its text is not reliably read,
              and React leaves its text alone on any render that keeps the
              Handle rare, so it is not read again. It moves no focus. */}
          <p aria-live="polite" data-rare-announcement="" className="sr-only">
            {rare ? copy.rareAnnouncement : ""}
          </p>

          {rare || suggestions.length > 0 ? (
            <div className="flex flex-col gap-5 pt-4 md:px-10 md:pt-6">
              {rare ? (
                // Hidden from assistive technology, which has the sentence
                // above; keyed on the Handle so a new rare triple plays the
                // pop afresh.
                <div key={segment} aria-hidden="true" className="flex">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-sunshine px-3 py-1 text-sm font-semibold text-ink motion-safe:animate-rare-pop">
                    <span>{"✨"}</span>
                    <span>{copy.rareBadge}</span>
                  </span>
                </div>
              ) : null}

              {suggestions.length === 0 ? null : (
                <div>
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
            </div>
          ) : null}

          <EmojiPicker onPick={fill} full={full} />

          {/* Step 2. Offered only with a claim endpoint, and not on a phone
              once the page has hydrated, where the claim sheet holds the form
              instead: there is only ever one claim form on the page. */}
          {claim === undefined || sheetMode ? null : claimable ? (
            <div
              data-claim-step="open"
              className="mt-8 bg-card p-5 max-md:rounded-card max-md:border max-md:border-line md:mt-0 md:rounded-b-[36px] md:border-t md:border-line md:px-10 md:py-8"
            >
              {/* Keyed on the Handle, so a rejection said about one Handle is
                  never left on screen under another, and the unlock plays for
                  each Handle that opens the step. Not for the Handle the page
                  opened on: `/[handle]` sends step 2 already open, before any
                  script, so nothing unlocked and nothing should move. */}
              <div
                key={segment}
                className={
                  segment ===
                  segmentOf(initialSlots(initialEmoji).filter(isFilled))
                    ? undefined
                    : "motion-safe:animate-step-unlock"
                }
              >
                <ClaimForm
                  claim={claim}
                  eyebrow={copy.stepLabel}
                  handle={segment}
                />
              </div>
            </div>
          ) : (
            <div
              data-claim-step="locked"
              className="mt-8 bg-paper p-5 max-md:rounded-card max-md:border max-md:border-dashed max-md:border-control md:mt-0 md:rounded-b-[36px] md:border-t md:border-line md:px-10 md:py-8"
            >
              <div className="md:grid md:grid-cols-[15rem_minmax(0,1fr)] md:items-center md:gap-x-10">
                <div>
                  <p className="mb-1.5 text-xs font-semibold tracking-[0.08em] text-muted uppercase">
                    {copy.stepLabel}
                  </p>
                  <h2 className="mb-2 font-display text-2xl leading-tight font-bold tracking-[-0.02em] text-body">
                    {en.Claim.claimHeading}
                  </h2>
                  <p className="text-[15px] text-body">{copy.stepLocked}</p>
                </div>
                {/* The fields to come, drawn as empty outlines. */}
                <div
                  aria-hidden="true"
                  className="mt-5 grid gap-3 md:mt-0 md:grid-cols-2"
                >
                  <div className="h-13 rounded-2xl border border-dashed border-control bg-card" />
                  <div className="h-13 rounded-2xl border border-dashed border-control bg-card" />
                  <div className="h-12 w-40 rounded-full bg-violet-tint" />
                </div>
              </div>
            </div>
          )}
        </div>

        {offerReopen ? (
          <div className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 md:hidden">
            <button
              type="button"
              onClick={() => {
                setDismissed(undefined);
              }}
              className="inline-flex min-h-13 w-full items-center justify-center rounded-full bg-violet px-6 text-base font-semibold text-white shadow-card hover:bg-violet-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet"
            >
              {copy.sheetReopen}
            </button>
          </div>
        ) : null}
      </section>

      {sheetMode ? (
        <ClaimSheet
          open={sheetOpen}
          labelledBy="claim-heading"
          onDismiss={dismissSheet}
          header={
            <>
              <span className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">
                {copy.slotsLabel}
              </span>
              <span className="inline-flex h-6.5 items-center gap-1.5 rounded-full bg-available-tint px-2.5 text-xs font-semibold text-available-ink">
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-available"
                />
                {copy.sheetAvailable}
              </span>
            </>
          }
        >
          <div
            role="group"
            aria-label={copy.slotsLabel}
            className="grid grid-cols-3 gap-2.5"
          >
            {slots.map((emoji, index) => (
              <HandleSlot
                key={index}
                size="sheet"
                position={index + 1}
                emoji={emoji}
                rare={rare}
                onClear={() => {
                  // Removing an emoji closes the sheet, because the Handle
                  // is no longer the available one; focus goes to the same
                  // slot in the bar.
                  returnFocusTo.current = index;
                  clear(index);
                }}
              />
            ))}
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="font-display text-xl leading-tight font-bold tracking-[-0.02em] text-ink">
              {spokenLine}
            </p>
            <p className="font-mono text-xs break-all text-muted">{url}</p>
          </div>
          <div aria-hidden="true" className="h-px bg-line" />
          {segment === undefined ? null : (
            <ClaimForm key={segment} claim={claim} handle={segment} />
          )}
        </ClaimSheet>
      ) : null}
    </>
  );
}
