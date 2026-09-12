import type { CuratedEmoji } from "./emoji-name";
import { findCuratedEmoji } from "./emoji-name";

/**
 * The collapsed spoken form of a Handle — how a person says it out loud.
 *
 * The product's founding line is "three ice cubes", which is what this builds:
 * the curated plural for a repeated emoji, the curated article for a single one,
 * and a comma-and list when a Handle mixes them.
 *
 * **Runs collapse only when they are consecutive.** A Handle is an ordered
 * sequence and two Handles differ if their order differs (`CONTEXT.md`,
 * [ADR-0004](../../../../docs/adr/0004-the-handle-model.md)), so 🧊🍕🧊 reads
 * "an ice cube, a pizza and an ice cube" — collapsing both ice cubes into "two
 * ice cubes and a pizza" would say a different Handle. The all-same triple the
 * pitch is built on is just a run of three, so "three ice cubes" falls out of
 * the same rule rather than being a special case.
 */

const NUMBER_WORDS: readonly string[] = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

function numberWord(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
}

interface Run {
  readonly entry: CuratedEmoji;
  readonly count: number;
}

function toRuns(entries: readonly CuratedEmoji[]): Run[] {
  const runs: Run[] = [];
  for (const entry of entries) {
    const previous = runs.at(-1);
    if (previous?.entry.emoji === entry.emoji) {
      runs[runs.length - 1] = { entry, count: previous.count + 1 };
      continue;
    }
    runs.push({ entry, count: 1 });
  }
  return runs;
}

function sayRun(run: Run): string {
  if (run.count > 1) {
    return `${numberWord(run.count)} ${run.entry.plural}`;
  }
  const { article, displayName } = run.entry;
  return article === "none" ? displayName : `${article} ${displayName}`;
}

/** Joins parts as English does: "a", "a and b", "a, b and c". */
function joinParts(parts: readonly string[]): string {
  const last = parts.at(-1);
  if (last === undefined) {
    return "";
  }
  if (parts.length === 1) {
    return last;
  }
  return `${parts.slice(0, -1).join(", ")} and ${last}`;
}

/**
 * Build the collapsed spoken form of the Handle made of `codepoints`.
 *
 * Takes the code points a canonicalised Handle path splits into, in order.
 * Returns `undefined` when the Handle is empty or holds anything that is not a
 * claimable emoji — there is no spoken form for a Handle that cannot exist, and
 * a partial sentence would be worse than none.
 */
export function spokenHandle(
  codepoints: readonly string[],
): string | undefined {
  if (codepoints.length === 0) {
    return undefined;
  }

  const entries: CuratedEmoji[] = [];
  for (const codepoint of codepoints) {
    const entry = findCuratedEmoji(codepoint);
    if (entry === undefined) {
      return undefined;
    }
    entries.push(entry);
  }

  return joinParts(toRuns(entries).map(sayRun));
}
