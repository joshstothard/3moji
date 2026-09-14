"use client";

import { useState } from "react";
import { curatedEmojiSet, RELEASED_CATEGORIES } from "@template/core/browser";
import type { CuratedEmoji, EmojiCategory } from "@template/core/browser";
import en from "../../../../packages/shared/messages/en.json";

/**
 * The claimable emoji, reached by category.
 *
 * **The categories are the released drop, read straight from the domain.** One
 * control per entry of `RELEASED_CATEGORIES`, in that list's order, so the next
 * drop ([ADR-0007](../../../../docs/adr/0007-release-the-emoji-set-in-category-drops.md)
 * decision 5 releases a category as a line of data) needs no edit here. There
 * is deliberately no hard-coded list of category names in this file.
 *
 * **The category tabs are the only way to change what is listed** (#253). The
 * picker once had a search box too; the owner asked for it to go. `searchEmoji`
 * stays in `packages/core` for the header search
 * ([#254](https://github.com/joshstothard/3moji/issues/254)).
 *
 * **The category controls are toggle buttons, not `role="tab"`,** and #253
 * keeps them exactly as they were: `aria-pressed` on the one whose emoji are
 * listed, plain Tab to every control, and #78's `focus-visible` ring. Changing
 * them to a tablist would change their keyboard behaviour (arrow keys, one tab
 * stop), which is its own decision, not a side effect of removing search.
 *
 * **Inside the composer** ([#263](https://github.com/joshstothard/3moji/issues/263)).
 * The picker is part of the builder's card rather than a block of its own, so
 * its heading is for assistive technology only. On a phone the row of tabs
 * sticks under the Handle bar while the grid scrolls, scrolls sideways rather
 * than wrapping, and runs edge to edge; from `md` it sits in the card and
 * wraps. The pressed tab is ink, as the connected layout draws it.
 *
 * Each emoji button is named by its **curated display name**, and the glyph
 * inside it is `aria-hidden`. Without that, a screen reader reads the code
 * point rather than the word, which is the failure #78's accessibility
 * criterion names: the product's whole claim is that a Handle can be said out
 * loud, so the name is the content and the glyph is the decoration.
 */
interface EmojiPickerProps {
  readonly onPick: (emoji: string) => void;
  /** Whether all three slots are taken, so there is nowhere to put a pick. */
  readonly full: boolean;
}

const copy = en.HandleBuilder;

function inCategory(
  category: EmojiCategory | undefined,
): readonly CuratedEmoji[] {
  return curatedEmojiSet.filter((entry) => entry.category === category);
}

export function EmojiPicker({ onPick, full }: EmojiPickerProps) {
  // `RELEASED_CATEGORIES[0]` is `EmojiCategory | undefined` under
  // `noUncheckedIndexedAccess`, and the union is carried rather than asserted
  // away: an empty released list would show an empty category, not crash.
  const [category, setCategory] = useState<EmojiCategory | undefined>(
    RELEASED_CATEGORIES[0],
  );

  const shown = inCategory(category);

  return (
    <section aria-labelledby="emoji-picker-heading">
      <h3 id="emoji-picker-heading" className="sr-only">
        {copy.pickerHeading}
      </h3>

      {/* On a phone this row sticks straight under the Handle bar: the header
          is 4rem (5rem from `sm`) and the bar 78px, each overlapping the one
          above by a pixel so no sliver of the page shows between them. It is
          opaque paper and runs the full width of the screen. */}
      <div
        data-picker-tabs=""
        className="z-[5] bg-paper pt-0.5 pb-1.5 max-md:sticky max-md:top-[calc(8.875rem-2px)] max-md:mx-[calc(50%-50vw)] max-md:border-b max-md:border-line max-md:px-4 max-md:shadow-[0_10px_24px_-18px_rgb(26_21_35/0.4)] sm:max-md:top-[calc(9.875rem-2px)] sm:max-md:px-8 md:bg-transparent md:px-10 md:pt-6 md:pb-0"
      >
        <div
          role="group"
          aria-label={copy.pickerCategoriesLabel}
          className="flex gap-2 max-md:-mx-1 max-md:overflow-x-auto max-md:p-1 max-md:[scrollbar-width:none] md:flex-wrap"
        >
          {RELEASED_CATEGORIES.map((released) => (
            <button
              key={released}
              type="button"
              // Pressed only when the grid below is this category's content.
              aria-pressed={released === category}
              onClick={() => {
                setCategory(released);
              }}
              // The border is the builder's (#243): the white fill is about
              // 1.04:1 on paper, so the border is what identifies the control.
              // Pressed, the tab is ink (#263) and the border takes the fill's
              // colour: the ink fill is the cue, 16.87:1 on paper.
              className="inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-medium border border-control bg-card text-body hover:bg-violet-tint hover:border-violet focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet aria-pressed:bg-ink aria-pressed:border-ink aria-pressed:text-white aria-pressed:hover:bg-ink"
            >
              {released}
            </button>
          ))}
        </div>
      </div>

      <p
        aria-live="polite"
        className="min-h-5 pt-2 text-sm text-muted md:px-10"
      >
        {full ? copy.pickerFull : ""}
      </p>

      {shown.length === 0 ? null : (
        // Five equal columns on a phone (about 56px cells at 390px), and from
        // `sm` as many columns of at least 4rem as fit, so the leftover width
        // is shared out rather than left as a gap on the right (#253).
        <ul className="mt-2 grid grid-cols-5 gap-2 max-md:px-2 sm:grid-cols-[repeat(auto-fill,minmax(4rem,1fr))] sm:gap-2.5 md:px-10 md:pb-8">
          {shown.map((entry) => (
            // Keyed by code point, which is unique across the curated set, so
            // switching category re-orders the buttons rather than remounting
            // the ones that stay.
            <li key={entry.emoji}>
              <button
                type="button"
                // `aria-disabled`, never `disabled`: a disabled button leaves
                // the tab order, and a browser drops the focus of whoever is
                // standing on it. Filling the third slot must not eject a
                // keyboard user from the grid (WCAG 2.4.3 Focus Order).
                aria-disabled={full}
                aria-label={entry.displayName}
                onClick={() => {
                  if (!full) {
                    onPick(entry.emoji);
                  }
                }}
                // A full Handle removes the hover affordance rather than fading
                // the grid out: dimming it reads as breakage, and the state is
                // already announced by `aria-disabled` and said in words above.
                //
                // A square cell the width of its column, glyph centred. On an
                // iPhone a tap drew a grey highlight box and a long press offered
                // to select or share the glyph (#253): neither is a focus
                // indicator, so both go, and focus stays `focus-visible` only.
                className="flex aspect-square w-full items-center justify-center text-[36px] leading-none select-none [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] rounded-2xl sm:rounded-[20px] sm:text-[44px] bg-paper border border-control hover:bg-violet-tint hover:border-violet focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet aria-disabled:cursor-not-allowed aria-disabled:hover:bg-paper aria-disabled:hover:border-control"
              >
                <span aria-hidden="true">{entry.emoji}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
