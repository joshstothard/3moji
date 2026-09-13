#!/usr/bin/env node
//
// Fails when two files in `docs/adr` share a four-digit number (#36).
//
// ## The failure this guards against
//
// The `adr` skill used to take the next number from the *local* `docs/adr`
// folder. A branch created before another ADR merged sees a stale folder, so
// two branches open at once both take the same number and neither notices.
// ADR-0003 reached `main` twice that way (#22 and #34), and the repair in #35
// had to edit the title line of an already-Accepted ADR, which Absolute Rule 5
// otherwise forbids.
//
// The skill now reads `origin/main`, but a skill is guidance an agent may
// deviate from. This check is the deterministic layer: it runs in
// `scripts/verify.sh` and in CI, where a pull request is checked out as its
// merge with `main`, so a collision with an ADR that merged after the branch
// was cut fails the build instead of landing.
//
// Usage: node scripts/check-adr-numbers.mjs [dir]   (default: docs/adr)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const NUMBERED_ADR = /^(\d{4})-/;

/**
 * Groups numbered ADR filenames by their four-digit prefix and returns only the
 * prefixes held by more than one file, in numeric order, files sorted by name.
 * Names without a `NNNN-` prefix (a README, a template) are ignored.
 *
 * @param {readonly string[]} filenames
 * @returns {{ number: string, files: string[] }[]}
 */
export function findDuplicateAdrNumbers(filenames) {
  /** @type {Map<string, string[]>} */
  const byNumber = new Map();
  for (const name of filenames) {
    const match = NUMBERED_ADR.exec(name);
    if (match === null) continue;
    const number = match[1];
    const files = byNumber.get(number) ?? [];
    files.push(name);
    byNumber.set(number, files);
  }

  return [...byNumber.entries()]
    .filter(([, files]) => files.length > 1)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([number, files]) => ({ number, files: [...files].sort() }));
}

/**
 * @param {{ dir?: string }} [options]
 * @returns {{ ok: boolean, message: string }}
 */
export function checkAdrNumbers({
  dir = path.join(repoRoot, "docs/adr"),
} = {}) {
  let filenames;
  try {
    filenames = fs.readdirSync(dir);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: `BLOCKED: cannot read ADR directory ${dir}: ${reason}`,
    };
  }

  const duplicates = findDuplicateAdrNumbers(filenames);
  if (duplicates.length === 0) {
    return { ok: true, message: "ADR number check passed." };
  }

  return {
    ok: false,
    message: [
      "BLOCKED: more than one ADR has the same number.",
      "",
      ...duplicates.flatMap(({ number, files }) => [
        `  ADR-${number}:`,
        ...files.map((file) => `    ${file}`),
      ]),
      "",
      "Renumber the ADR that has not merged yet to the next number free on",
      "origin/main. Never renumber one that is already Accepted on main (see",
      "AGENTS.md Absolute Rule 5, and issue #36).",
    ].join("\n"),
  };
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  const dirArg = process.argv[2];
  const result = checkAdrNumbers(
    dirArg === undefined ? {} : { dir: path.resolve(dirArg) },
  );
  if (result.ok) {
    console.log(result.message);
  } else {
    console.error(result.message);
    process.exit(1);
  }
}
