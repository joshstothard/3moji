// Tests for scripts/check-adr-numbers.mjs. Run with `npm run test:scripts`.
//
// The guard exists because ADR-0003 reached `main` twice (#35, #36): two
// branches opened at the same time each took the next number from a stale
// local `docs/adr`. These tests are written from that failure, not from the
// implementation.
//
// Nothing here reads this checkout's real `docs/adr`. A test that did would go
// green for as long as `main` happens to be clean, whether or not the check
// works. The CLI tests run against throwaway directories under the OS temp dir.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

import {
  checkAdrNumbers,
  findDuplicateAdrNumbers,
} from "./check-adr-numbers.mjs";

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "check-adr-numbers.mjs",
);

const scratchDirs = [];

after(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** A temp `docs/adr`-shaped directory holding empty files with these names. */
function makeAdrDir(names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-adr-numbers-36-"));
  scratchDirs.push(dir);
  for (const name of names) {
    fs.writeFileSync(path.join(dir, name), "");
  }
  return dir;
}

describe("findDuplicateAdrNumbers", () => {
  it("reports nothing when every number is unique", () => {
    assert.deepEqual(
      findDuplicateAdrNumbers([
        "0001-record-architecture-decisions.md",
        "0002-track-work-in-github-issues.md",
        "0003-auto-merge-pull-requests-on-green-ci.md",
      ]),
      [],
    );
  });

  it("reports two files that share a four-digit prefix — the ADR-0003 collision", () => {
    assert.deepEqual(
      findDuplicateAdrNumbers([
        "0001-record-architecture-decisions.md",
        "0003-auto-merge-pull-requests-on-green-ci.md",
        "0003-nextjs-on-vercel-is-the-whole-application.md",
      ]),
      [
        {
          number: "0003",
          files: [
            "0003-auto-merge-pull-requests-on-green-ci.md",
            "0003-nextjs-on-vercel-is-the-whole-application.md",
          ],
        },
      ],
    );
  });

  it("reports every colliding number, each once, in numeric order", () => {
    assert.deepEqual(
      findDuplicateAdrNumbers([
        "0007-b.md",
        "0002-a.md",
        "0007-a.md",
        "0002-b.md",
        "0002-c.md",
        "0005-only.md",
      ]),
      [
        { number: "0002", files: ["0002-a.md", "0002-b.md", "0002-c.md"] },
        { number: "0007", files: ["0007-a.md", "0007-b.md"] },
      ],
    );
  });

  it("ignores files that are not numbered ADRs", () => {
    assert.deepEqual(
      findDuplicateAdrNumbers([
        "README.md",
        "0001-a.md",
        "template.md",
        ".DS_Store",
      ]),
      [],
    );
  });
});

describe("checkAdrNumbers", () => {
  it("passes a directory with unique numbers", () => {
    const result = checkAdrNumbers({
      dir: makeAdrDir(["0001-a.md", "0002-b.md", "README.md"]),
    });
    assert.equal(result.ok, true);
  });

  it("fails a directory with a duplicate and names both files", () => {
    const result = checkAdrNumbers({
      dir: makeAdrDir(["0001-a.md", "0001-b.md", "0002-c.md"]),
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /0001-a\.md/);
    assert.match(result.message, /0001-b\.md/);
  });
});

describe("check-adr-numbers.mjs CLI", () => {
  function run(dir) {
    return spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
  }

  it("exits 0 when numbers are unique", () => {
    const result = run(makeAdrDir(["0001-a.md", "0002-b.md"]));
    assert.equal(result.status, 0, result.stderr);
  });

  it("exits 1 and prints the colliding files when two share a number", () => {
    const result = run(makeAdrDir(["0004-a.md", "0004-b.md"]));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /0004-a\.md/);
    assert.match(result.stderr, /0004-b\.md/);
  });

  it("exits 1 rather than passing when the directory does not exist", () => {
    const result = run(path.join(os.tmpdir(), "check-adr-numbers-36-missing"));
    assert.equal(result.status, 1);
  });
});
