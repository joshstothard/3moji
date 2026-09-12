import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import {
  canonicalise,
  curatedEmojiSet,
  EMOJI_CATEGORIES,
  findCuratedEmoji,
  findEmojiByCodepoint,
  HANDLE_LENGTH,
  isCategoryReleased,
  isClaimableEmoji,
  releasedEmojiSet,
  RELEASED_CATEGORIES,
  searchEmoji,
  spokenHandle,
} from "./browser";
import type {
  CanonicalisationResult,
  CuratedEmoji,
  EmojiSetEntry,
} from "./browser";

/**
 * The guard on `./browser.ts`.
 *
 * A client component importing `@template/core` fails `next build` with
 * `Can't resolve 'dns'` and four siblings, because the root entry point reaches
 * `pg` through `db/client`. `browser.ts` exists to be importable from the
 * browser, and nothing in TypeScript stops a later edit from re-exporting a
 * repository and putting the breakage back — the failure would surface in CI's
 * `build` job, several minutes and one push away from the edit that caused it.
 *
 * So this walks the module's transitive imports and asserts what they may be.
 * It reads source text rather than resolving modules for real: importing the
 * offending module is the thing being forbidden, so a test that imports to find
 * out would have to survive what it is checking for.
 */

const SRC = resolve(__dirname);

/** Package names that pull Node built-ins, or a server runtime, into a bundle. */
const FORBIDDEN_PACKAGES: readonly string[] = [
  "pg",
  "@neondatabase/serverless",
  "drizzle-orm",
  "better-auth",
  "@better-auth/drizzle-adapter",
];

/** Directories of the domain that exist only on the server. */
const FORBIDDEN_DIRECTORIES: readonly string[] = [
  "db",
  "auth",
  "ports",
  "adapters",
];

const IMPORT_PATTERN = /(?:from|import)\s*["']([^"']+)["']/g;

function specifiersOf(file: string): readonly string[] {
  const source = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1];
    if (specifier !== undefined) {
      found.push(specifier);
    }
  }
  return found;
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith(".");
}

interface Graph {
  /** Every source file reachable from the entry, relative to `src`. */
  readonly files: readonly string[];
  /** Every bare package specifier reachable from the entry. */
  readonly packages: readonly string[];
}

function walk(entry: string): Graph {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const queue: string[] = [entry];

  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) {
      continue;
    }
    seen.add(file);

    for (const specifier of specifiersOf(file)) {
      if (!isRelative(specifier)) {
        packages.add(specifier);
        continue;
      }
      queue.push(`${resolve(dirname(file), specifier)}.ts`);
    }
  }

  return {
    files: [...seen].map((file) => relative(SRC, file)),
    packages: [...packages],
  };
}

describe("the browser entry point", () => {
  const graph = walk(resolve(SRC, "browser.ts"));

  it.each(FORBIDDEN_PACKAGES)("never reaches %s", (name) => {
    const offenders = graph.packages.filter(
      (specifier) => specifier === name || specifier.startsWith(`${name}/`),
    );

    expect(offenders).toEqual([]);
  });

  it.each(FORBIDDEN_DIRECTORIES)("never reaches src/%s", (directory) => {
    const offenders = graph.files.filter((file) =>
      file.startsWith(`${directory}/`),
    );

    expect(offenders).toEqual([]);
  });

  it("reaches the emoji data it exists to expose, so the walk is not vacuous", () => {
    expect(graph.files).toContain("emoji/emoji-candidates.generated.ts");
    expect(graph.files).toContain("emoji/spoken-handle.ts");
    expect(graph.files).toContain("handle/canonicalise.ts");
  });
});

/**
 * The surface itself, exercised through the entry point alone — the same
 * discipline `index.test.ts` applies to the root one. A name left out of a
 * barrel file is not a type error anywhere; it is a client component that
 * cannot be written.
 */
describe("what the browser entry point exports", () => {
  it("exports the released Emoji Set and its curated layer", () => {
    expect(releasedEmojiSet).toHaveLength(307);
    expect(curatedEmojiSet).toHaveLength(307);

    const apple: EmojiSetEntry | undefined = findEmojiByCodepoint("🍎");
    expect(apple?.spokenName).toBe("red apple");
    expect(isClaimableEmoji("🍎")).toBe(true);
    expect(isClaimableEmoji("😀")).toBe(false);
  });

  it("exports the curated names the picker shows and the search behind them", () => {
    const ice: CuratedEmoji | undefined = findCuratedEmoji("🧊");
    expect(ice?.displayName).toBe("ice cube");
    expect(searchEmoji("frozen").map((entry) => entry.emoji)).toEqual(["🧊"]);
  });

  it("exports the spoken form the builder's tagline is built from", () => {
    expect(spokenHandle(["🧊", "🧊", "🧊"])).toBe("three ice cubes");
    expect(spokenHandle(["🧊", "🍕", "🧊"])).toBe(
      "an ice cube, a pizza and an ice cube",
    );
    expect(spokenHandle(["😀"])).toBeUndefined();
  });

  it("exports the canonicalisation the URL preview and the availability read use", () => {
    expect(HANDLE_LENGTH).toBe(3);

    const result: CanonicalisationResult = canonicalise("🧊🧊🧊");
    expect(result.ok ? result.key : undefined).toBe("🧊🧊🧊");
    expect(result.ok ? result.encoded : undefined).toBe(
      "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A",
    );
  });

  it("exports the categories, so a picker can tell a drop from the rest", () => {
    expect(EMOJI_CATEGORIES).toHaveLength(8);
    expect(RELEASED_CATEGORIES).toEqual([
      "Food & Drink",
      "Animals & Nature",
      "Activities",
    ]);
    expect(isCategoryReleased("Food & Drink")).toBe(true);
    expect(isCategoryReleased("Objects")).toBe(false);
  });
});
