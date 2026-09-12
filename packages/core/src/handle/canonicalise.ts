import type { EmojiCategory } from "../emoji/emoji-category";
import { findEmojiByCodepoint, type EmojiSetEntry } from "../emoji/emoji-set";

/**
 * The number of emoji a claimable Handle holds
 * ([ADR-0004](../../../../docs/adr/0004-the-handle-model.md) decision 2).
 * One- and two-emoji Handles are Reserved, so they are rejected here with the
 * same `wrong-length` reason as any other length: nothing downstream may claim
 * them, and a caller that 404s a two-emoji path is behaving correctly.
 */
export const HANDLE_LENGTH = 3;

/**
 * The presentation selectors: U+FE0E (text) and U+FE0F (emoji). NFC cannot
 * remove these — emoji code points have no canonical decomposition, so
 * normalisation is the identity over them — and a keyboard emits U+FE0F for any
 * text-default emoji. Stripping them is what makes `ice` and `ice + U+FE0F` one
 * Handle rather than two.
 *
 * Written as escapes and compared code point by code point rather than as a
 * character class: a variation selector is invisible in source, and a regex
 * literal holding one is unreviewable.
 */
const PRESENTATION_SELECTORS: readonly string[] = ["\u{FE0E}", "\u{FE0F}"];

function isPresentationSelector(codePoint: string): boolean {
  return PRESENTATION_SELECTORS.includes(codePoint);
}

/**
 * Why a segment is not a Handle. The caller branches on this, so the four are
 * deliberately different answers rather than one "invalid":
 *
 * - `malformed-encoding` — `decodeURIComponent` threw; the path is not even text.
 * - `wrong-length` — not exactly {@link HANDLE_LENGTH} code points. Covers the
 *   Reserved one- and two-emoji lengths.
 * - `unknown-codepoint` — not in the pinned candidate list at all: a letter, a
 *   ZWJ, a skin-tone modifier, an emoji the Emoji Set excludes.
 * - `unreleased-category` — a real Emoji Set entry whose category has not
 *   dropped yet (ADR-0007). "Not claimable yet" is a different answer from
 *   "not an emoji we know", and the interface may want to say so.
 */
export type CanonicalisationFailureReason =
  | "malformed-encoding"
  | "wrong-length"
  | "unknown-codepoint"
  | "unreleased-category";

/** A segment that is a Handle, with the canonical key it resolves to. */
export interface CanonicalHandle {
  readonly ok: true;
  /**
   * The canonical key: the bare code-point sequence, with no variation
   * selectors. This is what is stored under the `UNIQUE` index, and what every
   * caller should persist, compare and build URLs from.
   */
  readonly key: string;
  /**
   * `encodeURIComponent(key)` — the canonical percent-encoded path segment.
   * A `Location` header or a `permanentRedirect` must be given this, never the
   * raw key: a raw emoji in a header throws `ERR_INVALID_CHAR`.
   */
  readonly encoded: string;
  /**
   * Whether the segment passed in was byte-identical to {@link encoded}.
   *
   * **This is a routing answer, not a validity answer.** It exists so a page
   * can 308 a resolvable but non-canonical URL — a trailing U+FE0F, lower-case
   * `%xx` hex — to the canonical one. A caller that is not handling a URL (a
   * claim form passing raw emoji, say) gets `false` for a perfectly good
   * Handle and should read {@link key} and ignore this.
   */
  readonly isCanonical: boolean;
  /** The three Emoji Set entries, in order, for Spoken Names and rendering. */
  readonly emoji: readonly EmojiSetEntry[];
}

/** A segment that is not a Handle, and why. */
export type CanonicalisationFailure =
  | { readonly ok: false; readonly reason: "malformed-encoding" }
  | {
      readonly ok: false;
      readonly reason: "wrong-length";
      readonly length: number;
    }
  | {
      readonly ok: false;
      readonly reason: "unknown-codepoint";
      readonly codepoint: string;
    }
  | {
      readonly ok: false;
      readonly reason: "unreleased-category";
      readonly codepoint: string;
      readonly category: EmojiCategory;
    };

export type CanonicalisationResult = CanonicalHandle | CanonicalisationFailure;

/**
 * Decode the segment exactly once. Next.js hands `params.handle` over still
 * percent-encoded, and a malformed sequence makes `decodeURIComponent` throw
 * `URIError`; that is an ordinary rejection here, not an exception, because
 * every caller of this function is answering a public request.
 */
function decodeOnce(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/**
 * Split into code points, written without spreading the string:
 * `no-misused-spread` rightly flags that, and the intent here is explicit —
 * one entry per code point, so a surrogate pair never splits in half.
 */
function toCodePoints(value: string): readonly string[] {
  const codePoints: string[] = [];
  for (let index = 0; index < value.length;) {
    const code = value.codePointAt(index);
    if (code === undefined) {
      break;
    }
    const codePoint = String.fromCodePoint(code);
    codePoints.push(codePoint);
    index += codePoint.length;
  }
  return codePoints;
}

/**
 * Resolve the code points against the Emoji Set, reporting the **leftmost**
 * offender. First offender wins so the reason a caller renders is a function of
 * the input alone, not of the order of the candidate data.
 */
type EmojiResolution =
  | { readonly ok: true; readonly emoji: readonly EmojiSetEntry[] }
  | CanonicalisationFailure;

function resolveEmoji(codePoints: readonly string[]): EmojiResolution {
  const emoji: EmojiSetEntry[] = [];
  for (const codePoint of codePoints) {
    const entry = findEmojiByCodepoint(codePoint);
    if (entry === undefined) {
      return { ok: false, reason: "unknown-codepoint", codepoint: codePoint };
    }
    if (!entry.released) {
      return {
        ok: false,
        reason: "unreleased-category",
        codepoint: codePoint,
        category: entry.category,
      };
    }
    emoji.push(entry);
  }
  return { ok: true, emoji };
}

/**
 * Turn a received URL path segment into the canonical key of a Handle, or say
 * why it is not one.
 *
 * The rule is [ADR-0004](../../../../docs/adr/0004-the-handle-model.md)
 * decision 1, established by
 * [the emoji URL report](../../../../docs/reports/2026-09-11-emoji-urls.md):
 * decode once, apply NFC, strip U+FE0E and U+FE0F, split into code points,
 * require exactly three, each in a **released** category (ADR-0007). The
 * canonical key is that bare code-point sequence.
 *
 * **This is the riskiest function in the product.** The `UNIQUE` index on the
 * key is byte equality under a deterministic collation, so it only means
 * "one owner per Handle" because every write goes through here first. It is
 * therefore covered by properties rather than examples: one key per spelling,
 * and — the half that the index actually needs — never one key for two
 * Handles.
 *
 * It returns a result rather than throwing. Every rejection above is an
 * ordinary answer to a public request: a page 404s it, and a redirect to the
 * canonical spelling is a different branch from a 404.
 *
 * @param segment The received path segment, as Next.js gives it — still
 * percent-encoded — or a raw emoji string. Not the whole path: a leading `/`
 * is a code point like any other and makes the segment too long.
 */
export function canonicalise(segment: string): CanonicalisationResult {
  const decoded = decodeOnce(segment);
  if (decoded === undefined) {
    return { ok: false, reason: "malformed-encoding" };
  }

  const codePoints = toCodePoints(decoded.normalize("NFC")).filter(
    (codePoint) => !isPresentationSelector(codePoint),
  );
  if (codePoints.length !== HANDLE_LENGTH) {
    return { ok: false, reason: "wrong-length", length: codePoints.length };
  }

  const resolved = resolveEmoji(codePoints);
  if (!resolved.ok) {
    return resolved;
  }

  const key = codePoints.join("");
  const encoded = encodeURIComponent(key);
  return {
    ok: true,
    key,
    encoded,
    isCanonical: segment === encoded,
    emoji: resolved.emoji,
  };
}
