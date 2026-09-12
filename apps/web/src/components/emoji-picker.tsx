"use client";

import { useState } from "react";
import {
  curatedEmojiSet,
  RELEASED_CATEGORIES,
  searchEmoji,
} from "@template/core/browser";
import type { CuratedEmoji, EmojiCategory } from "@template/core/browser";
import en from "../../../../packages/shared/messages/en.json";

/**
 * The claimable emoji, reached by category or by search.
 *
 * **The categories are the released drop, read straight from the domain.** One
 * control per entry of `RELEASED_CATEGORIES`, in that list's order, so the next
 * drop ([ADR-0007](../../../../docs/adr/0007-release-the-emoji-set-in-category-drops.md)
 * decision 5 releases a category as a line of data) needs no edit here. There
 * is deliberately no hard-coded list of category names in this file.
 *
 * **Search goes through `searchEmoji`, which spans the whole released set.**
 * The curated layer carries 937 distinct terms across display name, CLDR name,
 * plural and synonyms, which is the only reason "eggplant" finds 🍆 — a glyph
 * this UI never labels anything but "aubergine" (ADR-0005 decision 3).
 *
 * **The category controls are toggle buttons, not `role="tab"`.** A tablist
 * promises that exactly one tab is selected and that its panel is the selected
 * tab's content; search breaks both, because results span every category and
 * belong to no tab. `aria-pressed="false"` on all three during a search is an
 * honest description of that state, where `aria-selected="true"` on one of them
 * would be a false one. Plain Tab reaches every control, and each keeps #78's
 * `focus-visible` ring.
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

const SEARCH_FIELD_ID = "emoji-search";

function inCategory(
  category: EmojiCategory | undefined,
): readonly CuratedEmoji[] {
  return curatedEmojiSet.filter((entry) => entry.category === category);
}

/**
 * What the search line says. Three states, because a blank query and a query
 * nobody matches are different things: `searchEmoji("")` returns `[]` by
 * design, so treating "no results" as "no matches" would greet every first
 * visit with a failure message.
 */
function searchStatus(needle: string, matched: number): string {
  if (needle === "") {
    return "";
  }
  if (matched === 0) {
    return copy.pickerNoMatches.replace("{query}", needle);
  }
  return copy.pickerSearchScope;
}

export function EmojiPicker({ onPick, full }: EmojiPickerProps) {
  // `RELEASED_CATEGORIES[0]` is `EmojiCategory | undefined` under
  // `noUncheckedIndexedAccess`, and the union is carried rather than asserted
  // away: an empty released list would show an empty category, not crash.
  const [category, setCategory] = useState<EmojiCategory | undefined>(
    RELEASED_CATEGORIES[0],
  );
  const [query, setQuery] = useState("");

  const needle = query.trim();
  const shown = needle === "" ? inCategory(category) : searchEmoji(needle);
  const status = searchStatus(needle, shown.length);

  /** Picking a category abandons the search, so the tab shown is the tab read. */
  function openCategory(next: EmojiCategory) {
    setCategory(next);
    setQuery("");
  }

  return (
    <section aria-labelledby="emoji-picker-heading" className="mt-12">
      <h2
        id="emoji-picker-heading"
        className="text-sm font-semibold text-slate-900 uppercase tracking-wide"
      >
        {copy.pickerHeading}
      </h2>
      <p aria-live="polite" className="text-sm text-slate-500 mt-1 min-h-5">
        {full ? copy.pickerFull : ""}
      </p>

      <div className="mt-4">
        {/* A real label, visually hidden: a placeholder is not an accessible
            name (WCAG 3.3.2), and it disappears the moment typing starts. */}
        <label htmlFor={SEARCH_FIELD_ID} className="sr-only">
          {copy.pickerSearchLabel}
        </label>
        <input
          id={SEARCH_FIELD_ID}
          type="search"
          value={query}
          placeholder={copy.pickerSearchPlaceholder}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          className="w-full max-w-sm rounded-xl bg-white border border-slate-200 shadow-sm px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        />
      </div>

      <div
        role="group"
        aria-label={copy.pickerCategoriesLabel}
        className="mt-4 flex flex-wrap gap-2"
      >
        {RELEASED_CATEGORIES.map((released) => (
          <button
            key={released}
            type="button"
            // Pressed only when the grid below is actually this category's
            // content — never during a search, which spans all of them.
            aria-pressed={needle === "" && released === category}
            onClick={() => {
              openCategory(released);
            }}
            className="rounded-xl px-3 py-1.5 text-sm font-medium shadow-sm bg-white text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 aria-pressed:bg-indigo-600 aria-pressed:text-white aria-pressed:hover:bg-indigo-600"
          >
            {released}
          </button>
        ))}
      </div>

      <p aria-live="polite" className="mt-4 text-sm text-slate-500 min-h-5">
        {status}
      </p>

      {shown.length === 0 ? null : (
        <ul className="mt-2 flex flex-wrap gap-1">
          {shown.map((entry) => (
            // Keyed by code point, which is unique across the curated set, so
            // filtering re-orders the buttons rather than remounting them.
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
                className="text-2xl leading-none rounded-xl p-2 bg-white shadow-sm hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 aria-disabled:cursor-not-allowed aria-disabled:hover:bg-white"
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
