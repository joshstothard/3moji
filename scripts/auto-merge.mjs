#!/usr/bin/env node
// auto-merge.mjs: merges a pull request once CI passes on its up-to-date head
// commit. Run by .github/workflows/auto-merge.yml; the rules are ADR-0003 and
// docs/development/ci-cd.md § Auto-merge.
//
// evaluate() is the whole decision and takes plain data, so it is unit-tested in
// auto-merge.test.mjs. The rest of this file gathers that data with `gh api` and
// acts on the answer. It never touches a local git checkout.
//
// Usage (GH_TOKEN must be allowed to merge, update branches and dispatch CI):
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

function ciProblem(pr, ci) {
  if (!ci) return "ci-missing";
  if (ci.headSha !== pr.headSha) return "ci-stale";
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

// The newest CI run for a commit (GitHub lists runs newest first).
function latestCiRun(repo, sha) {
  const { workflow_runs: runs } = api(
    `repos/${repo}/actions/workflows/${CI_WORKFLOW}/runs?head_sha=${sha}&per_page=1`,
  );
  const [run] = runs;
  return run
    ? { status: run.status, conclusion: run.conclusion, headSha: run.head_sha }
    : null;
}

// A GITHUB_TOKEN merge or push triggers no push/pull_request workflows, but a
// workflow_dispatch is exempt, so CI is started explicitly.
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
    return reportFailure(repo, pr, "update the branch of", result.stderr);
  }
  // update-branch is asynchronous: dispatch CI only once the new head exists.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    sleep(3000);
    if (api(`repos/${repo}/pulls/${pr.number}`).head.sha !== pr.headSha) {
      dispatchCi(repo, pr.headRef);
      console.log(`#${pr.number}: updated from ${BASE_BRANCH}; CI dispatched`);
      return true;
    }
  }
  return reportFailure(
    repo,
    pr,
    "update the branch of",
    "GitHub accepted the update, but the head commit had not changed after 30 seconds.",
  );
}

function handle(repo, number) {
  const pr = loadPullRequest(repo, number);
  const ci = pr.state === "open" ? latestCiRun(repo, pr.headSha) : null;
  const decision = evaluate(pr, ci);
  console.log(
    `#${number} ${pr.title}: ${decision.action} (${decision.reason})`,
  );
  if (process.env.AUTO_MERGE_DRY_RUN === "1") return;
  if (decision.action === "merge") merge(repo, pr, decision.method);
  if (decision.action === "update") update(repo, pr);
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
  const requested = process.env.AUTO_MERGE_PR?.trim();
  if (requested) {
    handle(repo, toNumber(requested));
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
  for (const number of targets) handle(repo, number);
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
