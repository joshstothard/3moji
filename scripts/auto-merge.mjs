#!/usr/bin/env node
// auto-merge.mjs: merges a pull request once CI passes on its up-to-date head
// commit. Run by .github/workflows/auto-merge.yml; the rules are ADR-0003 and
// docs/development/ci-cd.md § Auto-merge.
//
// evaluate() is the whole decision and takes plain data, so it is unit-tested in
// auto-merge.test.mjs. The rest of this file gathers that data with `gh api` and
// acts on the answer. It never touches a local git checkout.
//
// Usage (GH_TOKEN must be allowed to merge, update branches, dispatch CI and
// close issues):
//   node scripts/auto-merge.mjs                        # every open PR into main
//   AUTO_MERGE_SHA=<sha> node scripts/auto-merge.mjs   # the same, the PR whose head is <sha> first
//   AUTO_MERGE_PR=42 node scripts/auto-merge.mjs       # only this PR
//   AUTO_MERGE_DRY_RUN=1 node scripts/auto-merge.mjs   # log decisions, change nothing

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const AUTOMERGE_LABEL = "automerge";
export const DEPENDABOT_LOGIN = "dependabot[bot]";

const BASE_BRANCH = "main";
const CI_WORKFLOW = "ci.yml";
const SAFE_UPDATE_TYPES = new Set(["semver-minor", "semver-patch"]);

// Dependabot lists every update in its commit message's YAML trailer as
// `update-type: version-update:semver-<major|minor|patch>`.
export function dependabotUpdateTypes(commitMessages) {
  return commitMessages.flatMap((message) =>
    [
      ...message.matchAll(
        /^\s*update-type:\s*version-update:(semver-[a-z]+)\s*$/gm,
      ),
    ].map((match) => match[1]),
  );
}

// True when any reviewer's most recent verdict requests changes. Comments do not
// count as a verdict, and a dismissed review comes back with state DISMISSED.
export function hasChangesRequested(reviews) {
  const latest = new Map();
  for (const review of reviews) {
    if (review.state === "COMMENTED" || review.state === "PENDING") continue;
    latest.set(review.user?.login, review.state);
  }
  return [...latest.values()].includes("CHANGES_REQUESTED");
}

function optInProblem(pr) {
  if (pr.labels.includes(AUTOMERGE_LABEL)) return null;
  if (pr.author !== DEPENDABOT_LOGIN) return "not-opted-in";
  const updates = dependabotUpdateTypes(pr.commitMessages);
  if (updates.length === 0) return "dependabot-no-metadata";
  return updates.every((type) => SAFE_UPDATE_TYPES.has(type))
    ? null
    : "dependabot-major";
}

// Never ran, still running and actually failed are three distinct states, and
// only the third is a verdict against the code. Collapsing the first into the
// third made auto-merge report `ci-failed` for a PR whose every check was green,
// on every run, forever (#125).
function ciProblem(pr, ci) {
  if (!ci) return "ci-missing";
  if (ci.headSha !== pr.headSha) return "ci-stale";
  if (ci.neverStarted) return "ci-not-started";
  if (ci.status !== "completed") return "ci-running";
  return ci.conclusion === "success" ? null : "ci-failed";
}

// Decide what to do with one pull request: merge it, update it from main so CI
// can re-run, or skip it. `pr` and `ci` are the plain shapes that
// loadPullRequest() and latestCiRun() build.
export function evaluate(pr, ci) {
  const skip = (reason) => ({ action: "skip", reason });
  if (pr.state !== "open") return skip("not-open");
  if (pr.draft) return skip("draft");
  if (pr.base !== BASE_BRANCH) return skip("base-not-main");
  const notOptedIn = optInProblem(pr);
  if (notOptedIn) return skip(notOptedIn);
  if (pr.changesRequested) return skip("changes-requested");
  const ciNotGreen = ciProblem(pr, ci);
  if (ciNotGreen) return skip(ciNotGreen);
  if (pr.mergeable === false) return skip("conflicts");
  if (pr.mergeable !== true) return skip("mergeability-unknown");
  if (pr.behindBy > 0) return { action: "update", reason: "behind-main" };
  // Squashing a PR that another PR is stacked on breaks the stacked chain.
  const method = pr.dependents > 0 ? "merge" : "squash";
  return { action: "merge", reason: "ready", method };
}

function fail(message) {
  process.stderr.write(`auto-merge: ${message}\n`);
  process.exit(1);
}

function gh(args, { allowFailure = false } = {}) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0 && !allowFailure) {
    fail(`gh ${args.join(" ")} failed:\n${result.stderr.trim()}`);
  }
  return result;
}

const api = (path) => JSON.parse(gh(["api", path]).stdout);

// Every element of a paginated REST list, one JSON object per output line.
function apiList(path) {
  const { stdout } = gh(["api", "--paginate", path, "--jq", ".[]"]);
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const sleep = (ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function currentRepo() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  return gh([
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "--jq",
    ".nameWithOwner",
  ]).stdout.trim();
}

function loadPullRequest(repo, number) {
  let raw = api(`repos/${repo}/pulls/${number}`);
  // GitHub computes mergeability in the background after a push.
  for (
    let attempt = 0;
    raw.state === "open" && raw.mergeable === null && attempt < 5;
    attempt += 1
  ) {
    sleep(3000);
    raw = api(`repos/${repo}/pulls/${number}`);
  }
  const author = raw.user.login;
  const active = raw.state === "open" && !raw.draft;
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    draft: raw.draft,
    base: raw.base.ref,
    headSha: raw.head.sha,
    headRef: raw.head.ref,
    author,
    labels: raw.labels.map((label) => label.name),
    mergeable: raw.mergeable,
    behindBy: active
      ? api(`repos/${repo}/compare/${BASE_BRANCH}...${raw.head.sha}`).behind_by
      : 0,
    commitMessages:
      active && author === DEPENDABOT_LOGIN
        ? apiList(`repos/${repo}/pulls/${number}/commits?per_page=100`).map(
            (commit) => commit.commit.message,
          )
        : [],
    dependents: active
      ? apiList(
          `repos/${repo}/pulls?state=open&per_page=100&base=${encodeURIComponent(raw.head.ref)}`,
        ).length
      : 0,
    changesRequested: active
      ? hasChangesRequested(
          apiList(`repos/${repo}/pulls/${number}/reviews?per_page=100`),
        )
      : false,
  };
}

// GitHub creates a workflow run for a commit authored by GITHUB_TOKEN and then
// refuses to start it. While it waits for a human to approve it, the run reads
// `action_required` in `status`, `conclusion`, or both (#117, #123). **GitHub
// does not keep that label**: the run is later finalised as `conclusion:
// failure`, still with zero jobs (runs 34745540993 on #128 and 34755777779 on
// #142, both measured on 2026-09-13; #145). A conclusion is therefore not
// evidence that a run started. Its jobs are.
const isAwaitingApproval = (run) =>
  run.status === "action_required" || run.conclusion === "action_required";

// Whether a run's verdict depends on its jobs. Only a completed run that did not
// succeed can be a refused run in disguise, so it is the only kind whose jobs
// are read: a green head costs no call beyond the run list. A queued or
// in-progress run can legitimately have no jobs yet, so it is never read, and
// stays `ci-running`.
const verdictNeedsJobs = (run) =>
  run.status === "completed" && run.conclusion !== "success";

// The CI run to judge a commit by, out of every run GitHub holds for it.
//
// After auto-merge updates a branch from main, two runs exist at the new head:
// the refused `pull_request` run above, and the `workflow_dispatch` run
// `dispatchCi()` started, which does run. They share a `created_at`, so listed
// order does not separate them and `per_page=1` could return either (#125).
// Prefer a run that was allowed to start, newest first — `id` breaks the
// created_at tie, since run ids increase. When nothing started, say so rather
// than reporting the refused run's conclusion as a verdict.
//
// A run never started when it awaits approval, or when it completed without
// success and has zero jobs, whatever its conclusion (#145). One that has jobs
// and failed, was cancelled or timed out is a real verdict. `jobCount(run)`
// returns the number of jobs a run has and may throw. If it does, the run is
// treated as one that started, and warned about: its non-success conclusion then
// becomes the verdict, so the gate skips with `ci-failed` rather than walking
// past it to an older green run and merging on that.
export function selectCiRun(runs, { jobCount, warn: warnOf }) {
  // An unparseable created_at gives NaN, which is falsy, so ordering falls back
  // to the id rather than leaving the comparator undefined.
  const newestFirst = [...runs].sort(
    (a, b) =>
      Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id,
  );
  const shape = (run, extra) => ({
    status: run.status,
    conclusion: run.conclusion,
    headSha: run.head_sha,
    ...extra,
  });
  const neverStarted = (run) => {
    if (isAwaitingApproval(run)) return true;
    if (!verdictNeedsJobs(run)) return false;
    try {
      return jobCount(run) === 0;
    } catch (error) {
      warnOf(
        `CI run ${run.id} at ${run.head_sha} concluded ${run.conclusion}, but its jobs could not be read, so it is judged as a run that started: ${errorMessage(error)}`,
      );
      return false;
    }
  };
  // find() stops at the first started run, so no older run's jobs are read.
  const started = newestFirst.find((run) => !neverStarted(run));
  if (started) return shape(started);
  return newestFirst.length > 0
    ? shape(newestFirst[0], { neverStarted: true })
    : null;
}

// `gh api` that throws on failure instead of ending the process, so a failed
// jobs read reaches selectCiRun()'s fail-closed path.
function apiOrThrow(path) {
  const result = gh(["api", path], { allowFailure: true });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `gh api ${path} failed`);
  }
  return JSON.parse(result.stdout);
}

// The CI verdict for a commit, in the shape evaluate() consumes. One call for
// the run list, plus one `jobs?per_page=1` call — whose `total_count` is the
// job count — for each completed non-success run walked past before a started
// run is found. The run list carries no job or check-run count of its own, and
// the check suite's `latest_check_runs_count` would cost the same one call but
// need `checks: read`, which auto-merge.yml does not grant.
export function latestCiRun(repo, sha, fetchJson = apiOrThrow, warnOf = warn) {
  return selectCiRun(ciRuns(repo, sha, fetchJson), {
    jobCount: (run) =>
      fetchJson(`repos/${repo}/actions/runs/${run.id}/jobs?per_page=1`)
        .total_count,
    warn: warnOf,
  });
}

// Every CI run GitHub holds for a commit, as the raw API objects.
function ciRuns(repo, sha, fetchJson = api) {
  return fetchJson(
    `repos/${repo}/actions/workflows/${CI_WORKFLOW}/runs?head_sha=${sha}&per_page=100`,
  ).workflow_runs;
}

// A GITHUB_TOKEN merge or push starts no push/pull_request workflow, but a
// workflow_dispatch is exempt, so CI is started explicitly.
//
// Measured caveat (#125): GitHub still *creates* the `pull_request` run it
// refuses to start, jobless and `action_required`, at the same `created_at` as
// the dispatched one. selectCiRun() is what tells them apart. And the dispatched
// run's completion does not trigger this workflow's `workflow_run` back, because
// that event too was raised by GITHUB_TOKEN (#58) — which is why gatePullRequest()
// waits for it in the same run instead.
function dispatchCi(repo, ref) {
  gh([
    "api",
    "-X",
    "POST",
    `repos/${repo}/actions/workflows/${CI_WORKFLOW}/dispatches`,
    "-f",
    `ref=${ref}`,
  ]);
}

function reportFailure(repo, pr, attempted, detail) {
  const reason = detail.trim() || "no error output";
  const marker = `<!-- auto-merge:${pr.headSha} -->`;
  const alreadyReported = apiList(
    `repos/${repo}/issues/${pr.number}/comments?per_page=100`,
  ).some((comment) => comment.body?.includes(marker));
  if (!alreadyReported) {
    const body = [
      marker,
      `Auto-merge could not ${attempted} this pull request:`,
      "",
      "```",
      reason,
      "```",
      "",
      "Merge it by hand, or push a fix and let CI run again. See `docs/development/ci-cd.md` § Auto-merge.",
    ].join("\n");
    gh(
      [
        "api",
        "-X",
        "POST",
        `repos/${repo}/issues/${pr.number}/comments`,
        "-f",
        `body=${body}`,
      ],
      {
        allowFailure: true,
      },
    );
  }
  process.stderr.write(`#${pr.number}: could not ${attempted} it: ${reason}\n`);
  process.exitCode = 1;
  return false;
}

function merge(repo, pr, method) {
  const args = [
    "api",
    "-X",
    "PUT",
    `repos/${repo}/pulls/${pr.number}/merge`,
    "-f",
    `merge_method=${method}`,
    "-f",
    `sha=${pr.headSha}`,
  ];
  if (method === "squash")
    args.push("-f", `commit_title=${pr.title} (#${pr.number})`);
  const result = gh(args, { allowFailure: true });
  if (result.status !== 0)
    return reportFailure(repo, pr, "merge", result.stderr);
  // Dependabot may already have deleted its branch; a missing ref is fine.
  gh(["api", "-X", "DELETE", `repos/${repo}/git/refs/heads/${pr.headRef}`], {
    allowFailure: true,
  });
  console.log(`#${pr.number}: merged (${method})`);
  dispatchCi(repo, BASE_BRANCH);
  return true;
}

// A warning annotation on the run, which does not fail the job. The message is
// escaped as GitHub's workflow-command syntax requires, so text from an API
// error cannot start a workflow command of its own on a new line.
function warn(line) {
  const escaped = line
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
  console.log(`::warning title=auto-merge::${escaped}`);
}

const CLOSING_ISSUES_QUERY = `query ($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      closingIssuesReferences(first: 100) {
        nodes { number state repository { nameWithOwner } }
      }
    }
  }
}`;

// GitHub's own list of the issues a pull request closes. The REST pull request
// object does not carry it, so this is the gate's one GraphQL call. Throws on
// any failure, which closeLinkedIssues() turns into a warning.
function closingIssues(repo, number) {
  const [owner, name] = repo.split("/");
  const result = gh(
    [
      "api",
      "graphql",
      "-f",
      `query=${CLOSING_ISSUES_QUERY}`,
      "-f",
      `owner=${owner}`,
      "-f",
      `name=${name}`,
      "-F",
      `number=${number}`,
    ],
    { allowFailure: true },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "gh api graphql failed");
  }
  const response = JSON.parse(result.stdout);
  if (response.errors?.length) {
    throw new Error(response.errors.map((error) => error.message).join("; "));
  }
  return response.data.repository.pullRequest.closingIssuesReferences.nodes;
}

// Close an issue, then say why on it. Closing comes first: a comment claiming a
// close that then failed would be worse than a closed issue with no comment. A
// failed close throws; a failed comment only warns, since the issue is closed.
function closeIssue(repo, issueNumber, prNumber) {
  const closed = gh(
    [
      "api",
      "-X",
      "PATCH",
      `repos/${repo}/issues/${issueNumber}`,
      "-f",
      "state=closed",
      "-f",
      "state_reason=completed",
    ],
    { allowFailure: true },
  );
  if (closed.status !== 0) {
    throw new Error(closed.stderr.trim() || "no error output");
  }
  const commented = gh(
    [
      "api",
      "-X",
      "POST",
      `repos/${repo}/issues/${issueNumber}/comments`,
      "-f",
      `body=Closed by #${prNumber} (merged by the auto-merge gate).`,
    ],
    { allowFailure: true },
  );
  if (commented.status !== 0) {
    warn(
      `#${prNumber}: closed #${issueNumber}, but could not comment on it: ${commented.stderr.trim()}`,
    );
  }
}

function update(repo, pr) {
  const result = gh(
    [
      "api",
      "-X",
      "PUT",
      `repos/${repo}/pulls/${pr.number}/update-branch`,
      "-f",
      `expected_head_sha=${pr.headSha}`,
    ],
    { allowFailure: true },
  );
  if (result.status !== 0) {
    reportFailure(repo, pr, "update the branch of", result.stderr);
    return null;
  }
  // update-branch is asynchronous: dispatch CI only once the new head exists.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    sleep(3000);
    const headSha = api(`repos/${repo}/pulls/${pr.number}`).head.sha;
    if (headSha !== pr.headSha) {
      const dispatchedAt = Date.now();
      dispatchCi(repo, pr.headRef);
      console.log(`#${pr.number}: updated from ${BASE_BRANCH}; CI dispatched`);
      return { headSha, dispatchedAt };
    }
  }
  reportFailure(
    repo,
    pr,
    "update the branch of",
    "GitHub accepted the update, but the head commit had not changed after 30 seconds.",
  );
  return null;
}

// How long one auto-merge run may spend waiting for CI it dispatched after
// updating branches, across every PR it evaluates. CI took about five minutes on
// every green run measured on 2026-09-13, so this covers a PR updated twice with
// room to spare. The workflow's job `timeout-minutes` must stay above it.
export const WAIT_BUDGET_MS = 20 * 60_000;
export const CI_POLL_MS = 15_000;
// The least budget worth starting an update with: about one CI run. With less,
// the branch would be updated and then abandoned mid-wait, which is #58 again.
export const MIN_WAIT_MS = 6 * 60_000;
// Updates of one PR per run. A second covers main moving once during the wait;
// after that the PR is left for a later run rather than chased indefinitely.
export const MAX_UPDATES = 2;
// `created_at` has one-second resolution and comes from GitHub's clock, not the
// runner's.
const DISPATCH_CLOCK_SKEW_MS = 30_000;

// The CI runs dispatchCi() started after an update. The dispatch API returns no
// run id, so they are recognised by what they must look like: a
// `workflow_dispatch` run at the head the update created, created no earlier
// than the dispatch. The head is a merge commit made seconds before, so no older
// run can be at it; the time bound is a second guard, not the only one.
export function dispatchedRuns(runs, { headSha, dispatchedAt }) {
  const notBefore =
    Math.floor(dispatchedAt / 1000) * 1000 - DISPATCH_CLOCK_SKEW_MS;
  return runs.filter(
    (run) =>
      run.event === "workflow_dispatch" &&
      run.head_sha === headSha &&
      Date.parse(run.created_at) >= notBefore,
  );
}

// Poll until the CI dispatched after an update has completed, or the run's wait
// budget is spent. Completion only ends the wait; the verdict is still read by
// latestCiRun() and evaluate() over every run at the head, so the #125 logic
// and every other gate apply exactly as on any other run.
function waitForDispatchedCi(updated, deps) {
  const pollMs = deps.pollMs ?? CI_POLL_MS;
  while (deps.now() < deps.deadline) {
    deps.sleep(pollMs);
    const mine = dispatchedRuns(deps.listCiRuns(updated.headSha), updated);
    if (mine.length > 0 && mine.every((run) => run.status === "completed")) {
      return true;
    }
  }
  return false;
}

// The issues a merged PR should close, out of GitHub's own list of the issues it
// links as closing (`closingIssuesReferences`): those in this repository that
// are still open. GitHub builds that list from closing keywords and the
// sidebar's links, so a `Part of #42` or `Refs #42` is never on it. A closing
// keyword aimed at another repository is dropped here, because the gate's token
// has no business there.
export function issuesToClose(nodes, repo) {
  return nodes.filter(
    (issue) =>
      issue.state === "OPEN" && issue.repository?.nameWithOwner === repo,
  );
}

const errorMessage = (error) =>
  error instanceof Error ? error.message : String(error);

// #42: GitHub's closing-keyword automation does not fire for a merge made with
// GITHUB_TOKEN, so after a successful merge the gate closes the PR's issues
// itself. The list is read after the merge, so an issue already closed — by a
// person, or by GitHub if it ever fires — is skipped and gets no second comment.
// Nothing here throws: the merge has happened, so a failure is a warning, never
// a failed run and never a reason to retry the merge.
function closeLinkedIssues(pr, deps) {
  let issues;
  try {
    issues = issuesToClose(deps.closingIssues(pr.number), deps.repo);
  } catch (error) {
    deps.warn(
      `#${pr.number}: merged, but could not read the issues it closes: ${errorMessage(error)}`,
    );
    return;
  }
  for (const issue of issues) {
    try {
      deps.closeIssue(issue.number, pr.number);
      deps.log(`#${pr.number}: closed #${issue.number}`);
    } catch (error) {
      deps.warn(
        `#${pr.number}: merged, but could not close #${issue.number}: ${errorMessage(error)}`,
      );
    }
  }
}

// Evaluate one pull request and act on the decision. Every GitHub call comes in
// through `deps`, so the whole path is unit-tested with a fake transport.
//
// A branch update is not the end of it (#58). The CI dispatched on the new head
// is started by GITHUB_TOKEN, so its completion raises no `workflow_run` and
// nothing would ever evaluate the PR again. So the gate waits for that run here
// and evaluates the PR afresh: merge when it is green and still up to date,
// update again (at most MAX_UPDATES times) when main moved meanwhile, and
// otherwise skip with a reason. Nothing merges that evaluate() did not approve
// on the head as it is at that moment.
export function gatePullRequest(number, deps) {
  const maxUpdates = deps.maxUpdates ?? MAX_UPDATES;
  let updates = 0;
  for (;;) {
    const pr = deps.loadPullRequest(number);
    const ci = pr.state === "open" ? deps.latestCiRun(pr.headSha) : null;
    let decision = evaluate(pr, ci);
    if (decision.action === "update" && !deps.dryRun) {
      // Updating without waiting would recreate the stall this loop removes.
      if (updates >= maxUpdates) {
        decision = { action: "skip", reason: "behind-main-after-update" };
      } else if (deps.deadline - deps.now() < MIN_WAIT_MS) {
        decision = { action: "skip", reason: "wait-budget-spent" };
      }
    }
    deps.log(`#${number} ${pr.title}: ${decision.action} (${decision.reason})`);
    if (deps.dryRun) return decision;
    if (decision.action === "merge") {
      // A failed merge has already been reported on the PR, and closes nothing.
      if (deps.merge(pr, decision.method)) closeLinkedIssues(pr, deps);
      return decision;
    }
    if (decision.action !== "update") return decision;
    // A failed update has already been reported on the PR.
    const updated = deps.update(pr);
    if (!updated) return decision;
    updates += 1;
    if (!waitForDispatchedCi(updated, deps)) {
      const timedOut = {
        action: "skip",
        reason: "ci-still-running-after-update",
      };
      deps.log(
        `#${number} ${pr.title}: ${timedOut.action} (${timedOut.reason})`,
      );
      return timedOut;
    }
  }
}

function handle(repo, number, deadline) {
  gatePullRequest(number, {
    loadPullRequest: (n) => loadPullRequest(repo, n),
    latestCiRun: (sha) => latestCiRun(repo, sha),
    listCiRuns: (sha) => ciRuns(repo, sha),
    merge: (pr, method) => merge(repo, pr, method),
    update: (pr) => update(repo, pr),
    repo,
    closingIssues: (number) => closingIssues(repo, number),
    closeIssue: (issueNumber, prNumber) =>
      closeIssue(repo, issueNumber, prNumber),
    warn,
    sleep,
    now: Date.now,
    deadline,
    log: (line) => console.log(line),
    dryRun: process.env.AUTO_MERGE_DRY_RUN === "1",
  });
}

const openPullNumbers = (repo) =>
  apiList(
    `repos/${repo}/pulls?state=open&per_page=100&base=${BASE_BRANCH}`,
  ).map((pull) => pull.number);

function toNumber(value) {
  const number = Number.parseInt(String(value).replace(/^#/, ""), 10);
  if (!Number.isInteger(number) || number <= 0) {
    fail(`AUTO_MERGE_PR must be a pull request number (got "${value}")`);
  }
  return number;
}

// Open pull requests whose head commit is `sha`.
const pullNumbersForSha = (repo, sha) =>
  apiList(`repos/${repo}/commits/${sha}/pulls`)
    .filter((pull) => pull.state === "open" && pull.head.sha === sha)
    .map((pull) => pull.number);

function main() {
  const repo = currentRepo();
  // One wait budget for the whole run, so several PRs updated in turn cannot
  // outlast the job timeout and be killed between an update and its merge.
  const deadline = Date.now() + WAIT_BUDGET_MS;
  const requested = process.env.AUTO_MERGE_PR?.trim();
  if (requested) {
    handle(repo, toNumber(requested), deadline);
    return;
  }
  // Runs share one concurrency group and GitHub keeps only the newest pending
  // run, so every run evaluates all open PRs, starting with the one that
  // triggered it. Each PR is loaded when its turn comes, so a merge part-way
  // through leaves the PRs after it behind main, and they are updated.
  const sha = process.env.AUTO_MERGE_SHA?.trim();
  const first = sha ? pullNumbersForSha(repo, sha) : [];
  const rest = openPullNumbers(repo).filter(
    (number) => !first.includes(number),
  );
  const targets = [...first, ...rest];
  if (targets.length === 0) console.log("No open pull request to evaluate.");
  for (const number of targets) handle(repo, number, deadline);
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return (
      fs.realpathSync(process.argv[1]) ===
      fs.realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
})();
if (isMain) main();
