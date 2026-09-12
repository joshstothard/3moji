import { releasedEmojiSet } from "../emoji/emoji-set";
import { canonicalise } from "../handle/canonicalise";

import { HANDLE_KEY_LENGTH, handleKeyOf, toHandleKey } from "./handle-key";

/**
 * A Handle built from the first three released emoji, so the tests never
 * hard-code emoji that a later category drop could make unclaimable.
 */
function releasedTriple(): string {
  return releasedEmojiSet
    .slice(0, HANDLE_KEY_LENGTH)
    .map((entry) => entry.emoji)
    .join("");
}

describe("toHandleKey", () => {
  it("yields a key for a canonicalisable Handle", () => {
    const triple = releasedTriple();

    expect(toHandleKey(triple)).toBe(triple);
  });

  it("collapses a presentation selector onto the same key", () => {
    const triple = releasedTriple();

    expect(toHandleKey(`${triple}\u{FE0F}`)).toBe(toHandleKey(triple));
  });

  it("accepts the percent-encoded form a URL arrives in", () => {
    const triple = releasedTriple();

    expect(toHandleKey(encodeURIComponent(triple))).toBe(triple);
  });

  it("refuses a Handle of the wrong length", () => {
    expect(toHandleKey(releasedEmojiSet[0]?.emoji ?? "")).toBeUndefined();
  });

  it("refuses a segment that is not emoji at all", () => {
    expect(toHandleKey("abc")).toBeUndefined();
  });

  it("refuses malformed percent-encoding", () => {
    expect(toHandleKey("%E0%A4%A")).toBeUndefined();
  });
});

describe("handleKeyOf", () => {
  it("brands the key an already-canonicalised Handle carries", () => {
    const result = canonicalise(releasedTriple());
    if (!result.ok) {
      throw new Error(`expected a Handle, got ${result.reason}`);
    }

    expect(handleKeyOf(result)).toBe(result.key);
  });
});

describe("HANDLE_KEY_LENGTH", () => {
  it("is the code-point length the database CHECK constrains", () => {
    expect(Array.from(releasedTriple())).toHaveLength(HANDLE_KEY_LENGTH);
  });
});
