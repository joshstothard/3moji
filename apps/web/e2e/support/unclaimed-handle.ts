import { randomInt } from "node:crypto";

import {
  canonicalise,
  curatedEmojiSet,
  HANDLE_LENGTH,
  isReservedHandle,
  type CuratedEmoji,
} from "@template/core";
import { unclaimedSeveralHandleKeys } from "./aliases";

/**
 * Three emoji nobody can have claimed: unreserved, not a three-of-a-kind (so no
 * celebration moves anything being measured), and none of the Handles
 * `handle-url.spec.ts` needs left unclaimed. Drawn at random, so both
 * Playwright projects and every retry get a Handle of their own in the shared
 * database, and nothing that calls this claims it.
 */
export function drawUnclaimedHandle(): readonly CuratedEmoji[] {
  const keep = unclaimedSeveralHandleKeys();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const entries = Array.from(
      { length: HANDLE_LENGTH },
      () => curatedEmojiSet[randomInt(curatedEmojiSet.length)],
    ).filter((entry): entry is CuratedEmoji => entry !== undefined);
    const glyphs = entries.map((entry) => entry.emoji);
    const result = canonicalise(glyphs.join(""));
    if (
      entries.length === HANDLE_LENGTH &&
      new Set(glyphs).size > 1 &&
      result.ok &&
      !isReservedHandle(result.key) &&
      !keep.has(result.key)
    ) {
      return entries;
    }
  }
  throw new Error("Could not draw an unreserved Handle.");
}

/** The canonical, percent-encoded path of a drawn Handle. */
export function pathOf(entries: readonly CuratedEmoji[]): string {
  const result = canonicalise(entries.map((entry) => entry.emoji).join(""));
  if (!result.ok) throw new Error("the drawn Handle did not canonicalise");
  return `/${result.encoded}`;
}
