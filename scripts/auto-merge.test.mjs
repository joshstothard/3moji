// Unit tests for the merge decision in auto-merge.mjs. No network is used:
// evaluate() takes plain data, so every rule in ADR-0003 can be checked directly,
// and gatePullRequest() takes its GitHub calls, clock and sleep as injected
// dependencies, so the update-wait-merge path runs against a fake. Run with
// `npm run test:scripts`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  dependabotUpdateTypes,
  evaluate,
  gatePullRequest,
  hasChangesRequested,
  latestCiRun,
  selectCiRun,
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

// When auto-merge updates a branch from main it pushes with GITHUB_TOKEN, and
// GitHub refuses to start a workflow for a GITHUB_TOKEN-authored commit: it
// creates the `pull_request` run anyway, with zero jobs and
// `conclusion: action_required`. `dispatchCi()` then starts a
// `workflow_dispatch` run that really does run. Both land at the same
// `created_at`, so which one the API lists first is not deterministic (#125).
// Measured on PR #117 at head a54112a:
//
//   34742068666 | pull_request      | completed/action_required  <- ZERO jobs
//   34742068590 | workflow_dispatch | completed/success          <- 15/15 green
//
// A run that was never allowed to start is not a run that failed. Never ran,
// still running and actually failed are three distinct states.

// GitHub lists workflow runs newest first and honours `per_page`. `runs` is
// given in that listed order, so slicing it reproduces exactly what `per_page=1`
// returned on #117: the blocked run, alone.
function fakeRunsApi(runs, calls = []) {
  return (path) => {
    calls.push(path);
    const perPage = Number(path.match(/[?&]per_page=(\d+)/)?.[1] ?? 30);
    return { workflow_runs: runs.slice(0, perPage) };
  };
}

const ciRun = (overrides) => ({
  id: 1,
  status: "completed",
  conclusion: "success",
  head_sha: "head-sha",
  created_at: "2026-09-13T06:09:58Z",
  event: "workflow_dispatch",
  ...overrides,
});

// The jobless run GitHub creates for a GITHUB_TOKEN push and refuses to start.
const blockedRun = (overrides) =>
  ciRun({
    id: 34742068666,
    conclusion: "action_required",
    event: "pull_request",
    ...overrides,
  });

const dispatchedRun = (overrides) =>
  ciRun({ id: 34742068590, event: "workflow_dispatch", ...overrides });

describe("latestCiRun", () => {
  it("reads the dispatched run that ran, not the jobless action_required run listed above it", () => {
    const ci = latestCiRun(
      "o/r",
      "head-sha",
      fakeRunsApi([blockedRun(), dispatchedRun()]),
    );
    assert.equal(ci.conclusion, "success");
    assert.deepEqual(evaluate(ownerPr(), ci), MERGE);
  });

  it("asks for more than one run at the head commit", () => {
    const calls = [];
    latestCiRun(
      "o/r",
      "head-sha",
      fakeRunsApi([blockedRun(), dispatchedRun()], calls),
    );
    const perPage = Number(calls[0].match(/[?&]per_page=(\d+)/)?.[1] ?? 30);
    assert.ok(
      perPage > 1,
      `latestCiRun asked for per_page=${perPage}: one run cannot tell a blocked run from the run that actually ran (#125)`,
    );
  });

  it("still reports a genuine pull_request failure as ci-failed", () => {
    const ci = latestCiRun(
      "o/r",
      "head-sha",
      fakeRunsApi([
        ciRun({ id: 3, event: "pull_request", conclusion: "failure" }),
      ]),
    );
    assert.deepEqual(evaluate(ownerPr(), ci), skip("ci-failed"));
  });

  it("still reports a genuine failure listed beside a blocked run", () => {
    const ci = latestCiRun(
      "o/r",
      "head-sha",
      fakeRunsApi([blockedRun(), ciRun({ id: 3, conclusion: "failure" })]),
    );
    assert.deepEqual(evaluate(ownerPr(), ci), skip("ci-failed"));
  });

  it("reports ci-not-started, not ci-failed, when every run at the head was blocked", () => {
    const ci = latestCiRun("o/r", "head-sha", fakeRunsApi([blockedRun()]));
    assert.deepEqual(evaluate(ownerPr(), ci), skip("ci-not-started"));
  });

  it("reports ci-not-started for a run still waiting for approval, not ci-running", () => {
    const ci = latestCiRun(
      "o/r",
      "head-sha",
      fakeRunsApi([
        blockedRun({ status: "action_required", conclusion: null }),
      ]),
    );
    assert.deepEqual(evaluate(ownerPr(), ci), skip("ci-not-started"));
  });

  it("prefers the newest started run when two share a created_at", () => {
    const ci = latestCiRun(
      "o/r",
      "head-sha",
      fakeRunsApi([
        ciRun({ id: 10, conclusion: "success" }),
        ciRun({ id: 9, conclusion: "failure" }),
      ]),
    );
    assert.deepEqual(evaluate(ownerPr(), ci), MERGE);
  });

  it("reports ci-missing when the head commit has no run at all", () => {
    const ci = latestCiRun("o/r", "head-sha", fakeRunsApi([]));
    assert.equal(ci, null);
    assert.deepEqual(evaluate(ownerPr(), ci), skip("ci-missing"));
  });

  it("keeps a run for an older head commit stale", () => {
    const ci = latestCiRun(
      "o/r",
      "head-sha",
      fakeRunsApi([ciRun({ head_sha: "previous-sha" })]),
    );
    assert.deepEqual(evaluate(ownerPr(), ci), skip("ci-stale"));
  });
});

// #58: after auto-merge updates a branch from main and dispatches CI, the
// dispatched run's completion raises no `workflow_run` — it was started by
// GITHUB_TOKEN, and GitHub suppresses the downstream event. Measured on #128: the
// PR sat green, labelled and mergeable for ten minutes with no gate run pending.
// So the run that updated the branch waits for that CI itself and decides in the
// same job, through the same evaluate() and selectCiRun() gates.
//
// fakeGitHub() is one PR and the CI runs at each of its heads, on a fake clock
// that moves only when the gate sleeps. An update behaves as measured on #128: a
// new head, a jobless `pull_request` run GitHub refuses to start (with the larger
// id), and the `workflow_dispatch` run that really runs, in the same second.
const MINUTE = 60_000;
const POLL_MS = 15_000;

const isoSeconds = (ms) =>
  new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");

function fakeGitHub({
  behindBy = 1,
  ciMinutes = 5,
  ciConclusion = "success",
  mainMovesDuringWaits = 0,
  budgetMinutes = 20,
  extraRunsAtUpdatedHead = () => [],
} = {}) {
  let clock = Date.parse("2026-09-13T07:33:32Z");
  const actions = [];
  const lines = [];
  const runs = new Map([
    [
      "stale-sha",
      [ciRun({ id: 100, head_sha: "stale-sha", event: "pull_request" })],
    ],
  ]);
  let pr = ownerPr({ headSha: "stale-sha", behindBy });
  let updates = 0;
  let mainMovesAt = Infinity;

  const asListed = (run) =>
    run.completesAt > clock
      ? { ...run, status: "in_progress", conclusion: null }
      : run;

  const deps = {
    loadPullRequest: () => ({
      ...pr,
      behindBy: clock >= mainMovesAt ? 1 : pr.behindBy,
    }),
    listCiRuns: (sha) => (runs.get(sha) ?? []).map(asListed),
    latestCiRun: (sha) => selectCiRun(deps.listCiRuns(sha)),
    update: (current) => {
      updates += 1;
      const headSha = `updated-sha-${updates}`;
      actions.push(`update ${current.headSha} -> ${headSha}`);
      const created_at = isoSeconds(clock);
      runs.set(headSha, [
        ...extraRunsAtUpdatedHead(headSha, clock),
        blockedRun({ id: 1000 + updates * 2, head_sha: headSha, created_at }),
        {
          ...dispatchedRun({
            id: 999 + updates * 2,
            head_sha: headSha,
            created_at,
            conclusion: ciConclusion,
          }),
          completesAt: clock + ciMinutes * MINUTE,
        },
      ]);
      pr = { ...pr, headSha, behindBy: 0 };
      mainMovesAt =
        updates <= mainMovesDuringWaits ? clock + 2 * MINUTE : Infinity;
      return { headSha, dispatchedAt: clock };
    },
    merge: (current, method) => {
      const run = runs.get(current.headSha)?.find((r) => r.completesAt);
      assert.ok(
        !run || clock >= run.completesAt,
        `merged ${current.headSha} before the CI dispatched on it completed`,
      );
      actions.push(`merge ${current.headSha} (${method})`);
      pr = { ...pr, state: "closed" };
      return true;
    },
    sleep: (ms) => {
      clock += ms;
    },
    now: () => clock,
    deadline: clock + budgetMinutes * MINUTE,
    pollMs: POLL_MS,
    log: (line) => lines.push(line),
  };
  return { deps, actions, lines, clock: () => clock };
}

describe("gatePullRequest: after updating a branch (#58)", () => {
  it("waits for the CI it dispatched and merges the updated head in the same run", () => {
    const github = fakeGitHub();
    const decision = gatePullRequest(12, github.deps);
    assert.deepEqual(github.actions, [
      "update stale-sha -> updated-sha-1",
      "merge updated-sha-1 (squash)",
    ]);
    assert.deepEqual(decision, MERGE);
  });

  it("does not merge when the CI it dispatched after updating fails", () => {
    const github = fakeGitHub({ ciConclusion: "failure" });
    const decision = gatePullRequest(12, github.deps);
    assert.deepEqual(github.actions, ["update stale-sha -> updated-sha-1"]);
    assert.deepEqual(decision, skip("ci-failed"));
  });

  it("stops waiting at the deadline and skips with a logged reason, without merging", () => {
    const github = fakeGitHub({ ciMinutes: 60, budgetMinutes: 20 });
    const decision = gatePullRequest(12, github.deps);
    assert.deepEqual(github.actions, ["update stale-sha -> updated-sha-1"]);
    assert.deepEqual(decision, skip("ci-still-running-after-update"));
    assert.ok(
      github.lines.some((line) =>
        line.includes("ci-still-running-after-update"),
      ),
      `no log line gave the skip reason: ${JSON.stringify(github.lines)}`,
    );
    assert.ok(
      github.clock() <= github.deps.deadline + POLL_MS,
      "waited past the deadline",
    );
  });

  it("updates again, rather than merging the stale head, when main moved during the wait", () => {
    const github = fakeGitHub({ mainMovesDuringWaits: 1 });
    const decision = gatePullRequest(12, github.deps);
    assert.deepEqual(github.actions, [
      "update stale-sha -> updated-sha-1",
      "update updated-sha-1 -> updated-sha-2",
      "merge updated-sha-2 (squash)",
    ]);
    assert.deepEqual(decision, MERGE);
  });

  it("gives up with a reason, never merging, when main keeps moving", () => {
    const github = fakeGitHub({ mainMovesDuringWaits: 10 });
    const decision = gatePullRequest(12, github.deps);
    assert.deepEqual(github.actions, [
      "update stale-sha -> updated-sha-1",
      "update updated-sha-1 -> updated-sha-2",
    ]);
    assert.deepEqual(decision, skip("behind-main-after-update"));
  });

  // Five minutes left is not zero, but it is less than one CI run: updating now
  // would leave the branch updated with nothing left to see its CI through.
  it("does not update a branch when too little wait budget is left to see its CI through", () => {
    const github = fakeGitHub({ budgetMinutes: 5 });
    const decision = gatePullRequest(12, github.deps);
    assert.deepEqual(github.actions, []);
    assert.deepEqual(decision, skip("wait-budget-spent"));
  });

  it("does not stop waiting for a completed dispatch run created before this update", () => {
    const github = fakeGitHub({
      extraRunsAtUpdatedHead: (headSha, clock) => [
        dispatchedRun({
          id: 500,
          head_sha: headSha,
          created_at: isoSeconds(clock - 10 * MINUTE),
        }),
      ],
    });
    const decision = gatePullRequest(12, github.deps);
    assert.deepEqual(github.actions, [
      "update stale-sha -> updated-sha-1",
      "merge updated-sha-1 (squash)",
    ]);
    assert.deepEqual(decision, MERGE);
  });

  it("changes nothing in a dry run", () => {
    const github = fakeGitHub();
    const decision = gatePullRequest(12, { ...github.deps, dryRun: true });
    assert.deepEqual(github.actions, []);
    assert.deepEqual(decision, { action: "update", reason: "behind-main" });
  });
});
