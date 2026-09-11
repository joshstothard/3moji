// Unit tests for the merge decision in auto-merge.mjs. The GitHub calls are not
// exercised here: evaluate() takes plain data, so every rule in ADR-0003 can be
// checked without a network. Run with `npm run test:scripts`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  dependabotUpdateTypes,
  evaluate,
  hasChangesRequested,
} from "./auto-merge.mjs";

// Verbatim head commit of Dependabot PR #1 in this repository.
const REAL_DEPENDABOT_MESSAGE = `chore(deps-dev): bump @nestjs/schematics from 11.1.0 to 12.0.0

Bumps [@nestjs/schematics](https://github.com/nestjs/schematics) from 11.1.0 to 12.0.0.
- [Release notes](https://github.com/nestjs/schematics/releases)
- [Commits](https://github.com/nestjs/schematics/compare/11.1.0...12.0.0)

---
updated-dependencies:
- dependency-name: "@nestjs/schematics"
  dependency-version: 12.0.0
  dependency-type: direct:development
  update-type: version-update:semver-major
...

Signed-off-by: dependabot[bot] <support@github.com>`;

// A grouped Dependabot commit with one metadata entry per update type given.
function dependabotMessage(...updateTypes) {
  const entries = updateTypes.map((type, index) =>
    [
      `- dependency-name: package-${index}`,
      "  dependency-version: 1.2.3",
      "  dependency-type: direct:production",
      `  update-type: version-update:${type}`,
    ].join("\n"),
  );
  return [
    "chore(deps): bump the minor-and-patch group across 1 directory with 2 updates",
    "",
    "---",
    "updated-dependencies:",
    ...entries,
    "...",
  ].join("\n");
}

const ownerPr = (overrides = {}) => ({
  number: 12,
  state: "open",
  draft: false,
  base: "main",
  headSha: "head-sha",
  headRef: "12-add-thing",
  author: "joshstothard",
  labels: ["automerge"],
  mergeable: true,
  behindBy: 0,
  commitMessages: [],
  dependents: 0,
  changesRequested: false,
  ...overrides,
});

const dependabotPr = (overrides = {}) =>
  ownerPr({
    author: "dependabot[bot]",
    labels: ["dependencies"],
    headRef: "dependabot/npm_and_yarn/minor-and-patch-1a2b3c",
    commitMessages: [dependabotMessage("semver-minor", "semver-patch")],
    ...overrides,
  });

const greenCi = (overrides = {}) => ({
  status: "completed",
  conclusion: "success",
  headSha: "head-sha",
  ...overrides,
});

const MERGE = { action: "merge", reason: "ready", method: "squash" };
const skip = (reason) => ({ action: "skip", reason });

describe("dependabotUpdateTypes", () => {
  it("reads the update type from a real Dependabot commit", () => {
    assert.deepEqual(dependabotUpdateTypes([REAL_DEPENDABOT_MESSAGE]), [
      "semver-major",
    ]);
  });

  it("reads every update in a grouped commit", () => {
    assert.deepEqual(
      dependabotUpdateTypes([
        dependabotMessage("semver-minor", "semver-patch"),
      ]),
      ["semver-minor", "semver-patch"],
    );
  });

  it("returns nothing for commits without Dependabot metadata", () => {
    assert.deepEqual(
      dependabotUpdateTypes([
        "Merge branch 'main' into dependabot/npm_and_yarn/x",
        "feat(#12): add thing",
      ]),
      [],
    );
  });
});

describe("hasChangesRequested", () => {
  const review = (login, state) => ({ user: { login }, state });

  it("is true when a reviewer's latest verdict requests changes", () => {
    assert.equal(
      hasChangesRequested([
        review("alice", "APPROVED"),
        review("alice", "CHANGES_REQUESTED"),
      ]),
      true,
    );
  });

  it("is false once that reviewer approves", () => {
    assert.equal(
      hasChangesRequested([
        review("alice", "CHANGES_REQUESTED"),
        review("alice", "APPROVED"),
      ]),
      false,
    );
  });

  it("ignores a comment left after a change request", () => {
    assert.equal(
      hasChangesRequested([
        review("alice", "CHANGES_REQUESTED"),
        review("alice", "COMMENTED"),
      ]),
      true,
    );
  });

  it("is false for a dismissed change request", () => {
    assert.equal(hasChangesRequested([review("alice", "DISMISSED")]), false);
  });

  it("keeps each reviewer's verdict separate", () => {
    assert.equal(
      hasChangesRequested([
        review("alice", "CHANGES_REQUESTED"),
        review("bob", "APPROVED"),
      ]),
      true,
    );
  });
});

describe("evaluate: owner pull requests", () => {
  it("squash-merges a labelled, up-to-date PR into main once CI passed on its head", () => {
    assert.deepEqual(evaluate(ownerPr(), greenCi()), MERGE);
  });

  it("uses a merge commit when another open PR is stacked on this branch", () => {
    assert.deepEqual(evaluate(ownerPr({ dependents: 1 }), greenCi()), {
      ...MERGE,
      method: "merge",
    });
  });

  it("does not merge a PR without the automerge label, even with green CI", () => {
    assert.deepEqual(
      evaluate(ownerPr({ labels: [] }), greenCi()),
      skip("not-opted-in"),
    );
  });

  it("does not merge a labelled PR while a reviewer's latest verdict requests changes", () => {
    assert.deepEqual(
      evaluate(ownerPr({ changesRequested: true }), greenCi()),
      skip("changes-requested"),
    );
  });

  it("does not merge a closed PR", () => {
    assert.deepEqual(
      evaluate(ownerPr({ state: "closed" }), greenCi()),
      skip("not-open"),
    );
  });

  it("does not merge a draft PR", () => {
    assert.deepEqual(
      evaluate(ownerPr({ draft: true }), greenCi()),
      skip("draft"),
    );
  });

  it("does not merge a PR whose base is not main", () => {
    assert.deepEqual(
      evaluate(ownerPr({ base: "11-parent-branch" }), greenCi()),
      skip("base-not-main"),
    );
  });

  it("does not merge when no CI run exists for the head commit", () => {
    assert.deepEqual(evaluate(ownerPr(), null), skip("ci-missing"));
  });

  it("does not merge on a CI run for an older head commit", () => {
    assert.deepEqual(
      evaluate(ownerPr(), greenCi({ headSha: "previous-sha" })),
      skip("ci-stale"),
    );
  });

  it("does not merge while CI is still running", () => {
    assert.deepEqual(
      evaluate(ownerPr(), greenCi({ status: "in_progress", conclusion: null })),
      skip("ci-running"),
    );
  });

  for (const conclusion of ["failure", "cancelled", "timed_out"]) {
    it(`does not merge when CI concluded ${conclusion}`, () => {
      assert.deepEqual(
        evaluate(ownerPr(), greenCi({ conclusion })),
        skip("ci-failed"),
      );
    });
  }

  it("does not merge a PR with merge conflicts", () => {
    assert.deepEqual(
      evaluate(ownerPr({ mergeable: false }), greenCi()),
      skip("conflicts"),
    );
  });

  it("does not merge while GitHub has not computed mergeability", () => {
    assert.deepEqual(
      evaluate(ownerPr({ mergeable: null }), greenCi()),
      skip("mergeability-unknown"),
    );
  });

  it("updates a green PR that is behind main instead of merging it on the stale run", () => {
    assert.deepEqual(evaluate(ownerPr({ behindBy: 3 }), greenCi()), {
      action: "update",
      reason: "behind-main",
    });
  });

  it("does not update a PR that is behind main when its CI failed", () => {
    assert.deepEqual(
      evaluate(ownerPr({ behindBy: 3 }), greenCi({ conclusion: "failure" })),
      skip("ci-failed"),
    );
  });
});

describe("evaluate: Dependabot pull requests", () => {
  it("merges a minor and patch update without a label once CI passed", () => {
    assert.deepEqual(evaluate(dependabotPr(), greenCi()), MERGE);
  });

  it("does not merge a PR that contains a major update", () => {
    assert.deepEqual(
      evaluate(
        dependabotPr({
          commitMessages: [dependabotMessage("semver-minor", "semver-major")],
        }),
        greenCi(),
      ),
      skip("dependabot-major"),
    );
  });

  it("does not merge a Dependabot PR with no update metadata", () => {
    assert.deepEqual(
      evaluate(
        dependabotPr({ commitMessages: ["chore: something"] }),
        greenCi(),
      ),
      skip("dependabot-no-metadata"),
    );
  });

  it("merges a major update when the owner added the automerge label", () => {
    assert.deepEqual(
      evaluate(
        dependabotPr({
          labels: ["dependencies", "automerge"],
          commitMessages: [REAL_DEPENDABOT_MESSAGE],
        }),
        greenCi(),
      ),
      MERGE,
    );
  });

  it("still merges after auto-merge added a merge commit from main", () => {
    assert.deepEqual(
      evaluate(
        dependabotPr({
          commitMessages: [
            dependabotMessage("semver-patch"),
            "Merge branch 'main' into dependabot/npm_and_yarn/minor-and-patch-1a2b3c",
          ],
        }),
        greenCi(),
      ),
      MERGE,
    );
  });

  it("does not trust Dependabot metadata in a PR from anyone else", () => {
    assert.deepEqual(
      evaluate(
        ownerPr({
          labels: [],
          commitMessages: [dependabotMessage("semver-patch")],
        }),
        greenCi(),
      ),
      skip("not-opted-in"),
    );
  });
});
