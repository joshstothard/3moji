/**
 * The Reserved Handle list: versioned data, beside the Emoji Set.
 *
 * [Issue #18](https://github.com/joshstothard/3moji/issues/18) settled it as
 * **three mechanisms, not one list**, and only the third is a literal list:
 *
 * 1. **Rules.** Every one- and two-emoji Handle is reserved. That rule is not
 *    here: `canonicalise` enforces it as `wrong-length`, because a Handle of
 *    the wrong length is not a Handle at all (ADR-0004 decision 2). This module
 *    answers about the *contents* of a three-emoji key.
 * 2. **{@link BLOCKED_EMOJI}** — nine emoji, reserved wherever they appear.
 * 3. **{@link RESERVED_HANDLE_ENTRIES}** — brand-like triples, platform-owned
 *    Handles, and case-by-case additions as harassing combinations are
 *    reported.
 *
 * **It is a file, not a table**, so every change is reviewable in a pull
 * request and readable in git history — #18 asked for exactly that, for the
 * same reason ADR-0007 decision 5 releases categories as data.
 *
 * **Additions apply to future Claims only.** Retroactively reserving a Handle
 * somebody already owns would orphan it, which needs a deliberate takedown
 * decision rather than a list edit. That property is *structural*, not merely
 * asserted: nothing on the resolve path — `canonicalise`, `toHandleKey`, the
 * `handle` table's primary key — reads this module. The claim gate
 * (`claimable.ts`) is the only reader, so an entry added today cannot affect a
 * row written yesterday.
 */

/** One emoji that no Handle may contain, in any position. */
export interface BlockedEmoji {
  /**
   * The `U+XXXX` notation, for provenance. Not a lookup key — and carried
   * redundantly beside {@link emoji} on purpose, so a test can reconcile the
   * row against the Emoji Set and catch a mis-keyed one.
   */
  readonly codepoint: string;
  /** The code point itself, as a single-character string. */
  readonly emoji: string;
  /**
   * The CLDR short name, repeated from the Emoji Set. Redundant on purpose: the
   * set holds near-identical glyphs, and a row attached to the wrong emoji
   * would otherwise satisfy every assertion while blocking the wrong thing.
   */
  readonly spokenName: string;
  /** Why it is blocked. #18 gave a reason for each; they are kept verbatim. */
  readonly why: string;
}

/**
 * The nine emoji reserved wherever they appear, in #18's order.
 *
 * They cost about 3.3 million of 1.17 billion Handles against the full
 * candidate list, which is negligible.
 *
 * **Seven of the nine are forward-looking today, and that is recorded rather
 * than hidden.** ADR-0007 released only Food & Drink, Animals & Nature and
 * Activities, so 🖕 (People & Body) and the six in Objects are already
 * unclaimable — `canonicalise` rejects them as `unreleased-category` before
 * this list is consulted. The two doing live work at launch are **🔫 water
 * pistol (Activities)** and **🔪 kitchen knife (Food & Drink)**. Keeping the
 * other seven means a later drop cannot quietly make them claimable, and a test
 * pins which are reachable so releasing a category is a visible change here.
 *
 * Deliberately **not** blocked, per #18: 💀 🔥 💩 🍑 🍆 🤮 🍷 🍺. They are
 * common and mostly playful; context is what makes them offensive, and context
 * is what reporting is for.
 */
export const BLOCKED_EMOJI: readonly BlockedEmoji[] = [
  {
    codepoint: "U+1F595",
    emoji: "🖕",
    spokenName: "middle finger",
    why: "Harassment, and the only emoji in the set whose sole use is an insult",
  },
  {
    codepoint: "U+1F52B",
    emoji: "🔫",
    spokenName: "water pistol",
    why: "Renders as a realistic firearm on older Android builds",
  },
  {
    codepoint: "U+1F4A3",
    emoji: "💣",
    spokenName: "bomb",
    why: "Threat",
  },
  {
    codepoint: "U+1F52A",
    emoji: "🔪",
    spokenName: "kitchen knife",
    why: "Threat",
  },
  {
    codepoint: "U+1FA93",
    emoji: "🪓",
    spokenName: "axe",
    why: "Threat",
  },
  {
    codepoint: "U+1F489",
    emoji: "💉",
    spokenName: "syringe",
    why: "Drugs",
  },
  {
    codepoint: "U+1F48A",
    emoji: "💊",
    spokenName: "pill",
    why: "Drugs",
  },
  {
    codepoint: "U+1F6AC",
    emoji: "🚬",
    spokenName: "cigarette",
    why: "Provider acceptable-use risk",
  },
  {
    codepoint: "U+1FA78",
    emoji: "🩸",
    spokenName: "drop of blood",
    why: "Gore in combination",
  },
];

/** Why a specific Handle is held. */
export type ReservedScope =
  /** Held so a squatter cannot impersonate a well-known brand. */
  | "brand"
  /** Held for 3moji's own use. */
  | "platform";

/** One specific Handle that no Account may Claim. */
export interface ReservedHandleEntry {
  /**
   * The canonical key: three **bare** code points, NFC, no presentation
   * selectors. It is compared to a canonicalised key by equality, so an entry
   * carrying a stray U+FE0F could never match anything — a test asserts the
   * shape rather than trusting the eye, because a variation selector is
   * invisible in source.
   */
  readonly key: string;
  readonly scope: ReservedScope;
  /** Why it is held. */
  readonly why: string;
}

/**
 * The specific reserved combinations.
 *
 * The eight brand-like triples are #18's, verbatim. **Six of the eight are
 * forward-looking**: only 🍎 (Food & Drink) and 🐦 (Animals & Nature) are in a
 * released category, so 👻👻👻, 🎵🎵🎵, 🛒🛒🛒, 🚀🚀🚀, 📷📷📷 and 🤖🤖🤖 are
 * already unclaimable for a different reason. They stay listed so the drop that
 * releases Smileys & Emotion, Objects or Travel & Places does not hand them to
 * a squatter in the same commit.
 *
 * The platform-owned handful is drawn **only from released categories**,
 * because its whole job is to stop a squatter taking something the product
 * needs now. Note what is *not* here: 🧊🧊🧊. ADR-0004 decision 2 names it as
 * freely claimable, first come first served, and an accepted ADR is immutable —
 * reserving it would need a new one.
 */
export const RESERVED_HANDLE_ENTRIES: readonly ReservedHandleEntry[] = [
  { key: "🍎🍎🍎", scope: "brand", why: "Brand-like: Apple" },
  { key: "👻👻👻", scope: "brand", why: "Brand-like: Snapchat" },
  { key: "🐦🐦🐦", scope: "brand", why: "Brand-like: Twitter" },
  { key: "🎵🎵🎵", scope: "brand", why: "Brand-like: TikTok" },
  { key: "🛒🛒🛒", scope: "brand", why: "Brand-like: Amazon" },
  { key: "🚀🚀🚀", scope: "brand", why: "Brand-like: SpaceX" },
  { key: "📷📷📷", scope: "brand", why: "Brand-like: Instagram" },
  { key: "🤖🤖🤖", scope: "brand", why: "Brand-like: Android" },
  {
    key: "🎉🎉🎉",
    scope: "platform",
    why: "Platform-owned: product announcements",
  },
  { key: "🎫🎫🎫", scope: "platform", why: "Platform-owned: support" },
  {
    key: "🍕🍕🍕",
    scope: "platform",
    why: "Platform-owned: the demo Profile shown in marketing",
  },
];

/**
 * The list as the guard reads it.
 *
 * It is a **parameter** rather than a module-level constant the guard closes
 * over, and that is not generality for its own sake: it is the only way to
 * prove #18's non-retroactivity rule. A test adds an entry for an
 * already-claimed Handle and shows the claim path now refuses it while the
 * resolve path returns the same key, `encoded` segment and `HandleKey`. Without
 * the seam, the test could only assert that today's list is not retroactive,
 * which is not the property.
 */
export interface ReservedHandleList {
  readonly blocked: readonly BlockedEmoji[];
  readonly entries: readonly ReservedHandleEntry[];
}

/** The shipped list. */
export const RESERVED_HANDLES: ReservedHandleList = {
  blocked: BLOCKED_EMOJI,
  entries: RESERVED_HANDLE_ENTRIES,
};

/** Why a Handle may not be Claimed. */
export type Reservation =
  | { readonly kind: "blocked-emoji"; readonly emoji: BlockedEmoji }
  | { readonly kind: "reserved-entry"; readonly entry: ReservedHandleEntry };

/**
 * Split into code points. `Array.from` drives the string iterator, so a
 * surrogate pair never splits in half, and it is not spread syntax, so it does
 * not trip `no-misused-spread`.
 */
function toCodePoints(value: string): readonly string[] {
  return Array.from(value);
}

/**
 * Why `key` is reserved, or `undefined` if it is not.
 *
 * Takes a **canonical key** — the bare code-point sequence `canonicalise`
 * returns. Handing it a raw URL segment would compare percent-encoding against
 * emoji and find nothing.
 *
 * Precedence is fixed so the reason shown to a person is a function of the
 * input alone and not of the order of the data:
 *
 * 1. **The rule beats the entry.** A blocked emoji is checked first, because
 *    "this emoji is not allowed anywhere" is a different and more useful
 *    message than "this particular Handle is taken".
 * 2. **The leftmost blocked emoji wins** — the same first-offender convention
 *    `canonicalise` uses, for the same reason.
 */
export function reservationOf(
  key: string,
  list: ReservedHandleList = RESERVED_HANDLES,
): Reservation | undefined {
  for (const codePoint of toCodePoints(key)) {
    const blocked = list.blocked.find((each) => each.emoji === codePoint);
    if (blocked !== undefined) {
      return { kind: "blocked-emoji", emoji: blocked };
    }
  }

  const entry = list.entries.find((each) => each.key === key);
  return entry === undefined ? undefined : { kind: "reserved-entry", entry };
}

/**
 * Whether `key` is Reserved. The shorthand for a caller with no interest in
 * *why* — anything that has to tell a person why should use
 * {@link reservationOf}, because "that emoji is blocked" and "that Handle is
 * held" are different answers.
 */
export function isReservedHandle(
  key: string,
  list: ReservedHandleList = RESERVED_HANDLES,
): boolean {
  return reservationOf(key, list) !== undefined;
}
