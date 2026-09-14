import type { Ref } from "react";
import { findCuratedEmoji } from "@template/core/browser";
import en from "../../../../packages/shared/messages/en.json";

const copy = en.HandleBuilder;

/**
 * One slot of the Handle builder: a single permanent button that shows the
 * emoji in it and removes that emoji when activated.
 *
 * **Self-contained on purpose.** Everything a slot draws lives here, so the
 * slot can be moved into another layout without the builder's markup coming
 * with it. The builder owns the state and passes in what this slot holds.
 *
 * **One control per slot, for the life of the page** (#78). Filling a slot
 * changes its label, and clearing it changes the label back. The node is never
 * replaced, so focus stays on the same slot after a removal. Every mark drawn
 * inside is `aria-hidden`, so the accessible name is the `aria-label` alone:
 * "Remove <name> from slot <n>", which contains the visible "Remove <name>"
 * label (WCAG 2.5.3).
 *
 * **Two ways to say "this removes it"**
 * ([#252](https://github.com/joshstothard/3moji/issues/252)):
 *
 * - **With a pointer that can hover**, hovering or keyboard-focusing a filled
 *   slot fades the emoji, draws a coral X over it, turns the border coral, and
 *   shows a "Remove <name>" label below it. Tailwind v4 already gates `hover:`
 *   on `(hover: hover)`, but not `focus-visible:`, so the focus variants carry
 *   `can-hover:` themselves.
 * - **On a touch screen**, where nothing hovers, every filled slot wears a small
 *   ink X badge instead (`no-hover:`).
 *
 * Coral is 3.70:1 on the slot's paper fill and 3.91:1 on white, enough for a
 * graphic and a control's edge (3:1) but not for text, so it draws only the X
 * and the border. The label is white on ink. Each mark is shown with `hidden`
 * and `flex`, never `opacity`, so an unhovered label takes up no space over the
 * text below it, and nothing animates: the rare three-of-a-kind hop is the
 * only motion here, and it is the builder's.
 */
interface HandleSlotProps {
  /** The slot's place in the Handle, counting from 1. */
  readonly position: number;
  /** The emoji in the slot, or `undefined` while it is empty. */
  readonly emoji: string | undefined;
  /** Whether the whole Handle is a rare three-of-a-kind (#202). */
  readonly rare: boolean;
  /** Called when a filled slot is activated. */
  readonly onClear: () => void;
  readonly ref?: Ref<HTMLButtonElement>;
}

/** The curated display name of an emoji, or the glyph if it has none. */
function nameOf(emoji: string): string {
  return findCuratedEmoji(emoji)?.displayName ?? emoji;
}

function classes(...names: readonly (string | false)[]): string | undefined {
  const joined = names.filter(Boolean).join(" ");
  return joined === "" ? undefined : joined;
}

export function HandleSlot({
  position,
  emoji,
  rare,
  onClear,
  ref,
}: HandleSlotProps) {
  const name = emoji === undefined ? undefined : nameOf(emoji);

  return (
    <button
      ref={ref}
      type="button"
      aria-disabled={name === undefined}
      aria-label={
        name === undefined
          ? copy.slotEmpty.replace("{position}", String(position))
          : copy.slotFilled
              .replace("{position}", String(position))
              .replace("{name}", name)
      }
      onClick={() => {
        if (name !== undefined) {
          onClear();
        }
      }}
      className={classes(
        "group relative aspect-square w-full text-5xl sm:text-7xl leading-none flex items-center justify-center rounded-slot bg-paper border border-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet aria-disabled:border-dashed",
        name !== undefined &&
          "hover:border-coral can-hover:focus-visible:border-coral",
      )}
    >
      {/* Keyed on the rarity so the glyph, never the button, remounts: the hop
          replays on every return to a rare triple, and the permanent control
          keeps its focus. */}
      <span
        key={rare ? "rare" : "plain"}
        data-slot-glyph=""
        aria-hidden="true"
        className={classes(
          rare && "inline-block motion-safe:animate-rare-hop",
          name !== undefined &&
            "group-hover:opacity-35 group-hover:grayscale-40 can-hover:group-focus-visible:opacity-35 can-hover:group-focus-visible:grayscale-40",
        )}
        style={
          rare
            ? { animationDelay: `${String((position - 1) * 120)}ms` }
            : undefined
        }
      >
        {emoji ?? ""}
      </span>

      {name === undefined ? null : (
        <>
          <span
            data-remove-mark=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 hidden items-center justify-center text-coral group-hover:flex can-hover:group-focus-visible:flex"
          >
            <svg
              viewBox="0 0 96 96"
              fill="none"
              stroke="currentColor"
              strokeWidth={7}
              strokeLinecap="round"
              className="size-3/5 max-h-24 max-w-24"
            >
              <path d="M22 22L74 74M74 22L22 74" />
            </svg>
            <span className="absolute top-full left-1/2 z-10 mt-2 -translate-x-1/2 whitespace-nowrap rounded-[10px] bg-ink px-2.5 py-1.5 text-[13px] leading-none font-medium text-white">
              {copy.slotRemoveHint.replace("{name}", name)}
            </span>
          </span>
          <span
            data-remove-badge=""
            aria-hidden="true"
            className="pointer-events-none absolute -top-1.5 -right-1.5 hidden size-6.5 items-center justify-center rounded-full bg-ink text-white no-hover:flex"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              className="size-3"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </span>
        </>
      )}
    </button>
  );
}
