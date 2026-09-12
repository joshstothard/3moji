"use client";

import { curatedEmojiSet } from "@template/core/browser";
import en from "../../../../packages/shared/messages/en.json";

/**
 * The flat grid of claimable emoji.
 *
 * **Deliberately flat.** Category tabs and search are
 * [#79](https://github.com/joshstothard/3moji/issues/79); this is the shell
 * they will sit on, so it offers the whole released set — 307 emoji across
 * three categories ([ADR-0007](../../../../docs/adr/0007-release-the-emoji-set-in-category-drops.md))
 * — in candidate-list order and nothing else.
 *
 * Each button is named by its **curated display name**, and the glyph inside it
 * is `aria-hidden`. Without that, a screen reader reads the code point rather
 * than the word, which is the failure #78's accessibility criterion names: the
 * product's whole claim is that a Handle can be said out loud, so the name is
 * the content and the glyph is the decoration.
 */
interface EmojiPickerProps {
  readonly onPick: (emoji: string) => void;
  /** Whether all three slots are taken, so there is nowhere to put a pick. */
  readonly full: boolean;
}

const copy = en.HandleBuilder;

export function EmojiPicker({ onPick, full }: EmojiPickerProps) {
  return (
    <section aria-labelledby="emoji-picker-heading" className="mt-12">
      <h2
        id="emoji-picker-heading"
        className="text-sm font-semibold text-slate-900 uppercase tracking-wide"
      >
        {copy.pickerHeading}
      </h2>
      <p className="text-sm text-slate-500 mt-1 min-h-5">
        {full ? copy.pickerFull : ""}
      </p>
      <ul className="mt-4 flex flex-wrap gap-1">
        {curatedEmojiSet.map((entry, index) => (
          <li key={`${entry.emoji}-${String(index)}`}>
            <button
              type="button"
              // `aria-disabled`, never `disabled`: a disabled button leaves the
              // tab order, and a browser drops the focus of whoever is standing
              // on it. Filling the third slot must not eject a keyboard user
              // from the grid (WCAG 2.4.3 Focus Order).
              aria-disabled={full}
              aria-label={entry.displayName}
              onClick={() => {
                if (!full) {
                  onPick(entry.emoji);
                }
              }}
              // A full Handle removes the hover affordance rather than fading
              // 307 emoji out: dimming the whole grid reads as breakage, and
              // the state is already announced by `aria-disabled` and said in
              // words above.
              className="text-2xl leading-none rounded-xl p-2 bg-white shadow-sm hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 aria-disabled:cursor-not-allowed aria-disabled:hover:bg-white"
            >
              <span aria-hidden="true">{entry.emoji}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
