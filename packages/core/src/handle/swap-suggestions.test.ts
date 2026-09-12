import { findEmojiByCodepoint } from "../emoji/emoji-set";
import { BLOCKED_EMOJI, RESERVED_HANDLES } from "./reserved-handles";
import {
  SWAP_SUGGESTION_LIMIT,
  swapSuggestions,
  type SwapSuggestion,
} from "./swap-suggestions";

/** 🍕 pizza, Food & Drink, released at launch. */
const PIZZA = "🍕";
/** 🦊 fox, Animals & Nature, released at launch. */
const FOX = "🦊";
/** 😀 grinning face, Smileys & Emotion — a category that is not released. */
const GRIN = "😀";

const PIZZA_TRIPLE = [PIZZA, PIZZA, PIZZA];

function categoryOf(emoji: string): string | undefined {
  return findEmojiByCodepoint(emoji)?.category;
}

function keysOf(suggestions: readonly SwapSuggestion[]): readonly string[] {
  return suggestions.map((suggestion) => suggestion.handle.key);
}

describe("swapSuggestions", () => {
  it("suggests something when the pick is taken", () => {
    const suggestions = swapSuggestions({ emoji: PIZZA_TRIPLE });

    expect(suggestions).toHaveLength(SWAP_SUGGESTION_LIMIT);
  });

  it("differs from the pick in exactly one position, at the position it reports", () => {
    const suggestions = swapSuggestions({ emoji: PIZZA_TRIPLE, limit: 9 });

    expect(suggestions.length).toBeGreaterThan(0);
    for (const { handle, position } of suggestions) {
      const emoji = handle.emoji.map((entry) => entry.emoji);
      const changed = emoji.filter(
        (each, index) => each !== PIZZA_TRIPLE[index],
      );

      expect(changed).toHaveLength(1);
      expect(emoji[position]).not.toBe(PIZZA_TRIPLE[position]);
    }
  });

  it("draws every swap from the same group as the emoji it replaces", () => {
    // ADR-0005 decision 4: colour was rejected as a suggestion axis because it
    // cannot be derived, and suggestions use the Unicode group already in the
    // data. That group is `category` on an Emoji Set entry.
    const suggestions = swapSuggestions({
      emoji: [PIZZA, FOX, PIZZA],
      limit: 9,
    });

    expect(suggestions.length).toBeGreaterThan(0);
    for (const { handle, position } of suggestions) {
      const swappedIn = handle.emoji[position]?.emoji;
      const replaced = [PIZZA, FOX, PIZZA][position];

      expect(swappedIn).toBeDefined();
      expect(categoryOf(swappedIn ?? "")).toBe(categoryOf(replaced ?? ""));
    }
  });

  it("never suggests the Handle that was picked", () => {
    const suggestions = swapSuggestions({ emoji: PIZZA_TRIPLE, limit: 50 });

    expect(keysOf(suggestions)).not.toContain(PIZZA_TRIPLE.join(""));
  });

  it("suggests no Handle twice", () => {
    const keys = keysOf(swapSuggestions({ emoji: PIZZA_TRIPLE, limit: 50 }));

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never suggests a Handle carrying a blocked emoji", () => {
    // 🔪 kitchen knife is Food & Drink, which is released, so swapping a Food &
    // Drink emoji can reach it — and the whole set is walked here rather than
    // the first few, because the filter has to hold for every rank.
    const keys = keysOf(swapSuggestions({ emoji: PIZZA_TRIPLE, limit: 500 }));
    const reachable = BLOCKED_EMOJI.filter(
      (blocked) => findEmojiByCodepoint(blocked.emoji)?.released === true,
    );

    expect(reachable.length).toBeGreaterThan(0);
    for (const blocked of reachable) {
      expect(keys.some((key) => key.includes(blocked.emoji))).toBe(false);
    }
  });

  it("never suggests a Reserved Handle, proven by reserving one it would offer", () => {
    const [first] = swapSuggestions({ emoji: PIZZA_TRIPLE });
    expect(first).toBeDefined();
    const reserved = first?.handle.key ?? "";

    const suggestions = swapSuggestions({
      emoji: PIZZA_TRIPLE,
      list: {
        ...RESERVED_HANDLES,
        entries: [
          ...RESERVED_HANDLES.entries,
          { key: reserved, scope: "platform", why: "Reserved by this test" },
        ],
      },
    });

    expect(keysOf(suggestions)).not.toContain(reserved);
    expect(suggestions).toHaveLength(SWAP_SUGGESTION_LIMIT);
  });

  it("spreads the swaps across positions rather than exhausting the first", () => {
    // A caller showing three suggestions should see three shapes, not three
    // variations on the first slot. The ordering is by rank then by position.
    const suggestions = swapSuggestions({ emoji: PIZZA_TRIPLE });

    expect(suggestions.map((suggestion) => suggestion.position)).toEqual([
      0, 1, 2,
    ]);
  });

  it("is deterministic, because a random suggestion is a flaky test", () => {
    const once = swapSuggestions({ emoji: PIZZA_TRIPLE, limit: 7 });
    const twice = swapSuggestions({ emoji: PIZZA_TRIPLE, limit: 7 });

    expect(keysOf(once)).toEqual(keysOf(twice));
  });

  it("honours the limit asked for", () => {
    expect(swapSuggestions({ emoji: PIZZA_TRIPLE, limit: 1 })).toHaveLength(1);
    expect(swapSuggestions({ emoji: PIZZA_TRIPLE, limit: 6 })).toHaveLength(6);
  });

  it.each([
    ["no", []],
    ["one", [PIZZA]],
    ["two", [PIZZA, PIZZA]],
    ["four", [PIZZA, PIZZA, PIZZA, PIZZA]],
  ])(
    "suggests nothing for %s emoji: there is no Handle to swap",
    (_n, emoji) => {
      expect(swapSuggestions({ emoji })).toEqual([]);
    },
  );

  it("suggests nothing when the pick is outside the released set", () => {
    // Nothing in an unreleased category can be claimed, so there is no honest
    // swap to offer within its group.
    expect(swapSuggestions({ emoji: [GRIN, GRIN, GRIN] })).toEqual([]);
  });

  it("suggests only Handles that canonicalise to the key they carry", () => {
    for (const { handle } of swapSuggestions({
      emoji: PIZZA_TRIPLE,
      limit: 20,
    })) {
      expect(handle.key).toBe(handle.emoji.map((each) => each.emoji).join(""));
      expect(handle.encoded).toBe(encodeURIComponent(handle.key));
    }
  });
});
