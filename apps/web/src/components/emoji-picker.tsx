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
    <section aria-labelledby="emoji-picker-heading" className="mt-12">
      <h2
        id="emoji-picker-heading"
        className="font-display text-[32px] leading-none font-extrabold tracking-[-0.04em] text-ink sm:text-5xl"
      >
        {copy.pickerHeading}
      </h2>
      <p aria-live="polite" className="text-sm text-muted mt-1 min-h-5">
        {full ? copy.pickerFull : ""}
      </p>

      <div
        role="group"
        aria-label={copy.pickerCategoriesLabel}
        className="mt-4 flex flex-wrap gap-2"
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
            // Pressed, it takes the fill's colour, because nothing is 3:1
            // against both `violet` and the page; the violet fill is the cue.
            className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium border border-control bg-card text-body hover:bg-violet-tint hover:border-violet focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet aria-pressed:bg-violet aria-pressed:border-violet aria-pressed:text-white aria-pressed:hover:bg-violet"
          >
            {released}
          </button>
        ))}
      </div>

      {shown.length === 0 ? null : (
        // Five equal columns on a phone (about 56px cells at 390px), and from
        // `sm` as many columns of at least 4rem as fit, so the leftover width
        // is shared out rather than left as a gap on the right (#253).
        <ul className="mt-6 grid grid-cols-5 gap-2 rounded-card border border-line bg-card p-3.5 sm:grid-cols-[repeat(auto-fill,minmax(4rem,1fr))] sm:gap-2.5 sm:rounded-card-lg sm:p-7">
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
