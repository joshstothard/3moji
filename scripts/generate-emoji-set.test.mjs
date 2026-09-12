// Unit tests for the Emoji Set generator. buildEntries() and renderModule()
// are pure, so every rule can be checked without touching the filesystem, and
// importing this module must not rewrite the committed data.
// Run with `npm run test:scripts`.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  buildEntries,
  CANDIDATE_REPORT,
  KNOWN_CATEGORIES,
  OUTPUT_FILE,
  renderModule,
} from "./generate-emoji-set.mjs";

// Verbatim entries from docs/reports/2026-09-11-emoji-set.candidates.json.
const APPLE = {
  codepoint: "U+1F34E",
  emoji: "🍎",
  spokenName: "red apple",
  group: "Food & Drink",
};
const GRINNING = {
  codepoint: "U+1F600",
  emoji: "😀",
  spokenName: "grinning face",
  group: "Smileys & Emotion",
};

describe("buildEntries", () => {
  it("renames Unicode's group to the domain's category", () => {
    assert.deepEqual(buildEntries([APPLE]), [
      {
        codepoint: "U+1F34E",
        emoji: "🍎",
        spokenName: "red apple",
        category: "Food & Drink",
      },
    ]);
  });

  it("preserves report order", () => {
    const order = buildEntries([GRINNING, APPLE]).map(
      (entry) => entry.codepoint,
    );

    assert.deepEqual(order, ["U+1F600", "U+1F34E"]);
  });

  it("rejects a report that is not an array", () => {
    assert.throws(() => buildEntries({ entries: [APPLE] }), TypeError);
  });

  it("rejects an entry missing a field", () => {
    assert.throws(
      () => buildEntries([{ ...APPLE, spokenName: undefined }]),
      /non-string spokenName/,
    );
  });

  it("rejects an entry with an empty field", () => {
    assert.throws(() => buildEntries([{ ...APPLE, emoji: "" }]), /emoji/);
  });

  it("rejects an unknown group, which would not typecheck downstream", () => {
    assert.throws(
      () => buildEntries([{ ...APPLE, group: "Fruit" }]),
      /unknown group "Fruit"/,
    );
  });

  it("rejects a multi-code-point emoji, excluded by ADR-0005", () => {
    // A flag (regional indicator pair) and a ZWJ sequence.
    for (const emoji of ["🇬🇧", "👩‍💻"]) {
      assert.throws(
        () => buildEntries([{ ...APPLE, emoji }]),
        /not a single code point/,
      );
    }
  });
});

describe("renderModule", () => {
  it("renders a module that declares the shipped constant", async () => {
    const source = await renderModule(buildEntries([APPLE]));

    assert.match(source, /do not edit by hand/);
    assert.match(
      source,
      /export const emojiCandidates: readonly EmojiCandidate\[\] = \[/,
    );
    assert.match(source, /category: "Food & Drink"/);
  });

  it("is idempotent against the committed output", async () => {
    // Guards the phantom diff: if the generator's formatting drifts from
    // Prettier's, every commit reformats the generated file.
    const report = JSON.parse(await readFile(CANDIDATE_REPORT, "utf8"));
    const rendered = await renderModule(buildEntries(report));

    assert.equal(rendered, await readFile(OUTPUT_FILE, "utf8"));
  });
});

describe("KNOWN_CATEGORIES", () => {
  it("covers every group present in the candidate report", async () => {
    const report = JSON.parse(await readFile(CANDIDATE_REPORT, "utf8"));
    const groups = [...new Set(report.map((entry) => entry.group))].sort();

    assert.deepEqual(groups, [...KNOWN_CATEGORIES].sort());
  });
});
