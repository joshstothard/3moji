import { findEmojiByCodepoint } from "../emoji/emoji-set";

import {
  BLOCKED_EMOJI,
  RESERVED_HANDLES,
  RESERVED_HANDLE_ENTRIES,
  isReservedHandle,
  reservationOf,
  type Reservation,
  type ReservedHandleList,
} from "./reserved-handles";

/**
 * Code points, not characters. `[...value].length` trips `no-misused-spread`
 * and `value.length` counts UTF-16 units, which makes every emoji two.
 */
function codePointCount(value: string): number {
  return Array.from(value).length;
}

/**
 * The blocked emoji a reservation names, or a description of what it was
 * instead.
 *
 * Narrowing the union by hand rather than reaching for
 * `expect.objectContaining`, which is typed `any` and so trips
 * `no-unsafe-assignment` under `strictTypeChecked`. The string fallbacks mean a
 * wrong answer reads as "undefined" or "reserved-entry" in the failure output
 * rather than as a bare `undefined`.
 */
function blockedEmojiIn(reservation: Reservation | undefined): string {
  if (reservation === undefined) {
    return "not reserved";
  }
  return reservation.kind === "blocked-emoji"
    ? reservation.emoji.emoji
    : `reserved-entry ${reservation.entry.key}`;
}

describe("the blocked emoji", () => {
  /**
   * Spelled out rather than derived from the array. A test parameterised on the
   * value it constrains constrains nothing: reading the length off
   * `BLOCKED_EMOJI` would pass however many rows were there, including none.
   * [#18](https://github.com/joshstothard/3moji/issues/18) settled nine.
   */
  it("is the nine emoji issue #18 settled, in order", () => {
    expect(BLOCKED_EMOJI.map((blocked) => blocked.emoji)).toEqual([
      "🖕",
      "🔫",
      "💣",
      "🔪",
      "🪓",
      "💉",
      "💊",
      "🚬",
      "🩸",
    ]);
  });

  /**
   * The redundant-field discipline of the curated names (see
   * `quality-strategy.md`): a hand-authored row keyed by code point satisfies
   * every other assertion while naming the wrong emoji. Each row therefore
   * repeats the CLDR name and the `U+XXXX` notation, and both are checked
   * against the Emoji Set.
   */
  it.each(BLOCKED_EMOJI)(
    "names $emoji the way the Emoji Set does",
    (blocked) => {
      const entry = findEmojiByCodepoint(blocked.emoji);

      expect(entry?.spokenName).toBe(blocked.spokenName);
      expect(entry?.codepoint).toBe(blocked.codepoint);
    },
  );

  it.each(BLOCKED_EMOJI)("gives a reason for blocking $emoji", (blocked) => {
    expect(blocked.why.length).toBeGreaterThan(0);
  });

  /**
   * ADR-0007 released Food & Drink, Animals & Nature and Activities only, so
   * most of the nine are already unclaimable for a different reason —
   * `canonicalise` rejects them with `unreleased-category`. The two that are
   * **live protection today** are spelled out, because that is the fact worth
   * failing on: a later drop that releases Objects must not quietly change what
   * this list is doing.
   */
  it("is live protection today only for the two in a released category", () => {
    const reachable = BLOCKED_EMOJI.filter(
      (blocked) => findEmojiByCodepoint(blocked.emoji)?.released === true,
    );

    expect(reachable.map((blocked) => blocked.emoji)).toEqual(["🔫", "🔪"]);
  });
});

describe("the reserved entries", () => {
  it("holds the eight brand-like triples and three platform-owned Handles", () => {
    expect(
      RESERVED_HANDLE_ENTRIES.filter((entry) => entry.scope === "brand").map(
        (entry) => entry.key,
      ),
    ).toEqual([
      "🍎🍎🍎",
      "👻👻👻",
      "🐦🐦🐦",
      "🎵🎵🎵",
      "🛒🛒🛒",
      "🚀🚀🚀",
      "📷📷📷",
      "🤖🤖🤖",
    ]);
    expect(
      RESERVED_HANDLE_ENTRIES.filter((entry) => entry.scope === "platform").map(
        (entry) => entry.key,
      ),
    ).toEqual(["🎉🎉🎉", "🎫🎫🎫", "🍕🍕🍕"]);
  });

  /**
   * An entry is compared against a canonical key by equality, so an entry that
   * is not itself canonical can never match. A stray U+FE0F is invisible in
   * source, which is exactly how that bug would ship.
   */
  it.each(RESERVED_HANDLE_ENTRIES)(
    "writes $key as three bare code points from the Emoji Set",
    (entry) => {
      expect(codePointCount(entry.key)).toBe(3);
      for (const codePoint of Array.from(entry.key)) {
        expect(findEmojiByCodepoint(codePoint)).toBeDefined();
      }
    },
  );

  it.each(RESERVED_HANDLE_ENTRIES)("gives a reason for $key", (entry) => {
    expect(entry.why.length).toBeGreaterThan(0);
  });

  /**
   * The same honesty check as the blocked emoji. Six of the eight brand triples
   * use emoji from categories that have not dropped, so they are forward-
   * looking rather than active. Every platform-owned entry is deliberately
   * drawn from a released category, because those exist to stop a squatter
   * taking something we need *now*.
   */
  it("protects 🍎🍎🍎 and 🐦🐦🐦 today, and every platform-owned Handle", () => {
    const claimableToday = RESERVED_HANDLE_ENTRIES.filter((entry) =>
      Array.from(entry.key).every(
        (codePoint) => findEmojiByCodepoint(codePoint)?.released === true,
      ),
    );

    expect(claimableToday.map((entry) => entry.key)).toEqual([
      "🍎🍎🍎",
      "🐦🐦🐦",
      "🎉🎉🎉",
      "🎫🎫🎫",
      "🍕🍕🍕",
    ]);
  });
});

describe("reservationOf", () => {
  it("passes an ordinary Handle", () => {
    expect(reservationOf("🍎🍌🍇")).toBeUndefined();
    expect(isReservedHandle("🍎🍌🍇")).toBe(false);
  });

  it("rejects a Handle holding a blocked emoji, wherever it appears", () => {
    for (const key of ["🔪🍎🍌", "🍎🔪🍌", "🍎🍌🔪"]) {
      expect(blockedEmojiIn(reservationOf(key))).toBe("🔪");
      expect(isReservedHandle(key)).toBe(true);
    }
  });

  it("rejects a blocked emoji whose category has not dropped yet", () => {
    expect(reservationOf("🖕🍎🍌")?.kind).toBe("blocked-emoji");
  });

  it("rejects a reserved entry", () => {
    const reservation = reservationOf("🍎🍎🍎");

    expect(reservation?.kind).toBe("reserved-entry");
    expect(
      reservation?.kind === "reserved-entry"
        ? reservation.entry.key
        : undefined,
    ).toBe("🍎🍎🍎");
    expect(
      reservation?.kind === "reserved-entry"
        ? reservation.entry.scope
        : undefined,
    ).toBe("brand");
    expect(reservationOf("🎉🎉🎉")?.kind).toBe("reserved-entry");
  });

  /**
   * Two rules with different answers need a fixed precedence, or the reason
   * shown to a person depends on the order of the data. The rule beats the
   * entry, and the **leftmost** blocked emoji wins — the same first-offender
   * convention `canonicalise` uses, for the same reason.
   */
  it("reports the leftmost blocked emoji, and the rule before the entry", () => {
    const list: ReservedHandleList = {
      blocked: RESERVED_HANDLES.blocked,
      entries: [
        ...RESERVED_HANDLES.entries,
        { key: "🔪🔫🍎", scope: "brand", why: "contrived, for the test" },
      ],
    };

    expect(blockedEmojiIn(reservationOf("🔪🔫🍎", list))).toBe("🔪");
  });

  /**
   * A one- or two-emoji Handle is Reserved by ADR-0004 decision 2, and
   * `canonicalise` already rejects it as `wrong-length`. This guard is not the
   * place that rule lives, and it must not pretend otherwise: it answers about
   * the *contents* of a key, so a two-emoji string holding nothing blocked is
   * simply not its business.
   */
  it("leaves the length rule to canonicalise", () => {
    expect(reservationOf("🍎🍌")).toBeUndefined();
    expect(reservationOf("🔪🍎")?.kind).toBe("blocked-emoji");
  });
});
