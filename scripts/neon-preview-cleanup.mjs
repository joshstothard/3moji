#!/usr/bin/env node
// Every decision the Neon preview branch cleanup makes (#258), as pure
// functions, with a thin command line for
// .github/workflows/neon-preview-cleanup.yml to call. Tested in
// scripts/neon-preview-cleanup.test.mjs; the workflow itself is guarded by
// scripts/neon-preview-cleanup-workflow-guard.test.mjs.
//
// Why it exists: the Vercel-managed Neon integration creates a
// `preview/<git branch>` database branch for each preview deployment, and
// deletes it only when Vercel deletes the last deployment on it, which by
// default is after about six months
// (neon.com/docs/guides/vercel-branch-cleanup, read 2026-09-14). Neon Free
// allows 10 branches per project, and the project reached that on 2026-09-14.
//
// - `decide`: skip until the owner sets NEON_CLEANUP_ENABLED=true. Skip a pull
//   request from a fork or a run Dependabot triggered, which get no secrets.
//   Otherwise fail naming every missing setting. Writes `proceed=true|false`.
// - `clean`: on `pull_request` closed, delete the branch named exactly
//   `preview/<head ref>`; on the hourly `schedule` or `workflow_dispatch`,
//   sweep every `preview/` branch whose name is neither an open pull
//   request's head branch nor the start of one (Neon may shorten long names).
//   Never `main`, the default branch, a protected branch, or anything without
//   the prefix.
//
// This repository and its Actions logs are public. Nothing here prints a
// secret, the project ID, or any API response body: a message names a setting
// or a branch, and an HTTP status. The API key goes only in a request header,
// never on a command line, which is why this calls the API with `fetch`
// rather than the workflow calling `curl`.

import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repository secrets the workflow reads. */
export const SECRET_NAMES = Object.freeze(["NEON_API_KEY"]);

/** Repository variables the workflow reads. Variables are not masked in logs. */
export const VARIABLE_NAMES = Object.freeze(["NEON_PROJECT_ID"]);

export const CONFIG_NAMES = Object.freeze([...SECRET_NAMES, ...VARIABLE_NAMES]);

/** The prefix the Vercel-managed integration gives every preview branch. */
export const PREVIEW_PREFIX = "preview/";

export const NEON_API = "https://console.neon.tech/api/v2";
export const GITHUB_API = "https://api.github.com";

const DEPENDABOT = "dependabot[bot]";

/**
 * A Neon project ID: lowercase words joined by hyphens, such as
 * `example-project-12345678`. Anything else could change the API path.
 */
const PROJECT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A guard against a paginated API that never stops answering. */
const MAX_PAGES = 50;
const GITHUB_PAGE_SIZE = 100;
const NEON_PAGE_SIZE = 100;

/** A present, non-blank value, trimmed, or undefined. */
function valueOf(env, name) {
  const value = env[name];
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

/**
 * `preview/<head ref>`, or undefined if the head ref could not be a git branch
 * name. Slashes are kept: the integration names `chore/x` `preview/chore/x`.
 *
 * @param {unknown} headRef
 * @returns {string | undefined}
 */
export function previewBranchName(headRef) {
  if (typeof headRef !== "string" || headRef === "") return undefined;
  // What git forbids in a branch name (git check-ref-format), plus `;`, `$`,
  // quotes and other shell text no branch here would ever carry.
  if (/[\s\x00-\x1f\x7f~^:?*[\\;$`'"<>|&(){}]/.test(headRef)) return undefined;
  if (headRef.includes("..") || headRef.includes("@{")) return undefined;
  if (headRef.startsWith("/") || headRef.endsWith("/")) return undefined;
  if (headRef.endsWith(".") || headRef.endsWith(".lock")) return undefined;
  return `${PREVIEW_PREFIX}${headRef}`;
}

/**
 * Whether a Neon branch is one this cleanup may ever delete: it has an ID, its
 * name starts with `preview/` and has something after it, and it is not
 * `main`, the project's default branch, or protected.
 *
 * @param {unknown} branch
 * @returns {boolean}
 */
export function isDeletablePreview(branch) {
  if (branch === null || typeof branch !== "object") return false;
  const { id, name } = /** @type {Record<string, unknown>} */ (branch);
  if (typeof id !== "string" || id === "") return false;
  if (typeof name !== "string") return false;
  if (!name.startsWith(PREVIEW_PREFIX) || name === PREVIEW_PREFIX) return false;
  if (name === "main") return false;
  if (/** @type {Record<string, unknown>} */ (branch).default !== false) {
    return false;
  }
  if (/** @type {Record<string, unknown>} */ (branch).protected === true) {
    return false;
  }
  return true;
}

/** The git branch a preview branch was made for. */
const gitBranchOf = (name) => name.slice(PREVIEW_PREFIX.length);

/**
 * The branches to delete when the pull request from `headRef` closes: the one
 * named exactly `preview/<headRef>`, unless another open pull request still
 * uses that git branch.
 *
 * @param {readonly unknown[]} branches
 * @param {unknown} headRef
 * @param {readonly string[]} openHeadRefs
 */
export function selectBranchesForClose(branches, headRef, openHeadRefs) {
  const name = previewBranchName(headRef);
  if (name === undefined) return [];
  if (openHeadRefs.includes(/** @type {string} */ (headRef))) return [];
  return branches.filter(
    (branch) =>
      isDeletablePreview(branch) &&
      /** @type {{ name: string }} */ (branch).name === name,
  );
}

/**
 * The branches a sweep deletes: every deletable preview branch whose name,
 * after `preview/`, is neither an open pull request's head branch nor the
 * start of one. Neon may shorten a long branch name, so a name that is the
 * start of an open head branch could be that branch, and it stays. The close
 * path does not use this rule: it deletes on an exact match only.
 *
 * @param {readonly unknown[]} branches
 * @param {readonly string[]} openHeadRefs
 */
export function selectBranchesToSweep(branches, openHeadRefs) {
  return branches.filter((branch) => {
    if (!isDeletablePreview(branch)) return false;
    const gitBranch = gitBranchOf(
      /** @type {{ name: string }} */ (branch).name,
    );
    return !openHeadRefs.some((ref) => ref.startsWith(gitBranch));
  });
}

/**
 * Whether this run should clean anything, and how.
 *
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {{ action: "skip" | "fail" | "run", mode?: "close" | "sweep", reason: string, missing: string[] }}
 */
export function decideCleanup(env) {
  const enabled =
    (env.NEON_CLEANUP_ENABLED ?? "").trim().toLowerCase() === "true";
  if (!enabled) {
    return {
      action: "skip",
      reason:
        "NEON_CLEANUP_ENABLED is not true, so no Neon branch was deleted. Set it once setup is done: docs/owner-actions.md, Clean up Neon preview branches.",
      missing: [],
    };
  }

  const event = valueOf(env, "EVENT_NAME");
  let mode;
  if (event === "pull_request") {
    mode = "close";
  } else if (event === "workflow_dispatch" || event === "schedule") {
    mode = "sweep";
  } else {
    return {
      action: "fail",
      reason:
        "This cleanup runs only for a closed pull request, a manual run or the hourly schedule.",
      missing: [],
    };
  }

  // Before the settings check: these runs get no secrets, so they would
  // otherwise look like a missing API key.
  if (
    mode === "close" &&
    valueOf(env, "PR_HEAD_REPO") !== valueOf(env, "REPOSITORY")
  ) {
    return {
      action: "skip",
      reason:
        "The pull request came from a fork, so this run has no secrets. The hourly sweep deletes its preview branch, if it has one.",
      missing: [],
    };
  }
  if (valueOf(env, "ACTOR") === DEPENDABOT) {
    return {
      action: "skip",
      reason:
        "Dependabot triggered this run, so it has no secrets. The hourly sweep deletes the preview branch, if there is one.",
      missing: [],
    };
  }

  const missing = CONFIG_NAMES.filter(
    (name) => valueOf(env, name) === undefined,
  );
  if (missing.length > 0) {
    return {
      action: "fail",
      reason: `Neon cleanup is enabled but these are not set: ${missing.join(", ")}. Add them in Settings, Secrets and variables, Actions.`,
      missing,
    };
  }

  if (
    !PROJECT_ID.test(/** @type {string} */ (valueOf(env, "NEON_PROJECT_ID")))
  ) {
    return {
      action: "fail",
      reason:
        "NEON_PROJECT_ID is not a Neon project ID (lowercase letters, digits and hyphens, as shown in the Neon project's Settings, General).",
      missing: [],
    };
  }

  if (mode === "close" && previewBranchName(env.HEAD_REF) === undefined) {
    return {
      action: "fail",
      reason:
        "The pull request's head branch name is empty or not a usable git branch name, so no preview branch name could be made from it.",
      missing: [],
    };
  }

  return {
    action: "run",
    mode,
    reason:
      mode === "close"
        ? "Neon cleanup is enabled and configured. Deleting this pull request's preview branch."
        : "Neon cleanup is enabled and configured. Sweeping preview branches with no open pull request.",
    missing: [],
  };
}

/** A branch name, safe to print on one line of a public log. */
const printable = (name) => String(name).replace(/[^A-Za-z0-9._/@+-]/g, "?");

/** An error whose message is safe to print: no body, no header, no value. */
class ApiError extends Error {}

/** One-line GitHub annotation text: no newlines, which would end the command. */
const annotate = (level, message) =>
  `::${level}::${message.replace(/\r?\n/g, " ")}`;

/**
 * Every open pull request, as { number, ref }. Fails rather than answering
 * short, because a short list would sweep a branch that is still in use.
 */
async function listOpenPulls({ fetch, repository, token }) {
  const pulls = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${GITHUB_API}/repos/${repository}/pulls?state=open&per_page=${GITHUB_PAGE_SIZE}&page=${page}`;
    const headers = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    };
    if (token !== undefined) headers.authorization = `Bearer ${token}`;
    let response;
    try {
      response = await fetch(url, { headers });
    } catch {
      throw new ApiError(
        "GitHub's list of open pull requests could not be reached.",
      );
    }
    if (response.status !== 200) {
      throw new ApiError(
        `GitHub's list of open pull requests answered HTTP ${response.status}.`,
      );
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw new ApiError("GitHub's list of open pull requests was not JSON.");
    }
    if (
      !Array.isArray(body) ||
      !body.every(
        (pull) =>
          Number.isSafeInteger(pull?.number) &&
          typeof pull?.head?.ref === "string",
      )
    ) {
      throw new ApiError(
        "GitHub's list of open pull requests was not in the expected shape.",
      );
    }
    pulls.push(
      ...body.map((pull) => ({ number: pull.number, ref: pull.head.ref })),
    );
    if (body.length < GITHUB_PAGE_SIZE) return pulls;
  }
  throw new ApiError(
    `GitHub's list of open pull requests ran past ${MAX_PAGES} pages.`,
  );
}

/** Every branch in the Neon project, across every page. */
async function listNeonBranches({ fetch, projectId, apiKey }) {
  const branches = [];
  const seen = new Set();
  let cursor;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ limit: String(NEON_PAGE_SIZE) });
    if (cursor !== undefined) params.set("cursor", cursor);
    const url = `${NEON_API}/projects/${encodeURIComponent(projectId)}/branches?${params}`;
    let response;
    try {
      response = await fetch(url, {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
        },
      });
    } catch {
      throw new ApiError("Neon's branch list could not be reached.");
    }
    if (response.status !== 200) {
      throw new ApiError(
        `Neon's branch list answered HTTP ${response.status}.`,
      );
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw new ApiError("Neon's branch list was not JSON.");
    }
    if (
      body === null ||
      typeof body !== "object" ||
      !Array.isArray(body.branches) ||
      !body.branches.every(
        (b) =>
          b !== null &&
          typeof b === "object" &&
          typeof b.id === "string" &&
          typeof b.name === "string",
      )
    ) {
      throw new ApiError("Neon's branch list was not in the expected shape.");
    }
    branches.push(...body.branches);
    const next = body.pagination?.next;
    if (
      typeof next !== "string" ||
      next === "" ||
      body.branches.length === 0 ||
      seen.has(next)
    ) {
      return branches;
    }
    seen.add(next);
    cursor = next;
  }
  throw new ApiError(`Neon's branch list ran past ${MAX_PAGES} pages.`);
}

/**
 * Deletes one branch. Resolves to "deleted" or "gone"; rejects with an
 * ApiError when Neon refuses (a default branch, a branch with children, an
 * operation in progress) or cannot be reached.
 */
async function deleteNeonBranch({ fetch, projectId, apiKey, branch }) {
  const url = `${NEON_API}/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branch.id)}`;
  let response;
  try {
    response = await fetch(url, {
      method: "DELETE",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
      },
    });
  } catch {
    throw new ApiError(
      `Neon could not be reached to delete ${printable(branch.name)}.`,
    );
  }
  // The body is never read into a message: it is discarded here.
  try {
    await response.body?.cancel();
  } catch {
    // Nothing to discard.
  }
  if (response.status === 200 || response.status === 202) return "deleted";
  // Neon answers 204 for a branch that does not exist or is already deleted.
  if (response.status === 204 || response.status === 404) return "gone";
  throw new ApiError(
    `Neon refused to delete ${printable(branch.name)}: HTTP ${response.status}.`,
  );
}

/**
 * Runs the cleanup the environment asks for. Resolves to an exit code: 0 when
 * everything selected is gone (or nothing needed doing), 1 otherwise.
 *
 * @param {Readonly<Record<string, string | undefined>>} env
 * @param {{ fetch: typeof globalThis.fetch, log: (line: string) => void }} io
 * @returns {Promise<number>}
 */
export async function clean(env, { fetch, log }) {
  const decision = decideCleanup(env);
  if (decision.action === "skip") {
    log(annotate("notice", decision.reason));
    return 0;
  }
  if (decision.action === "fail") {
    log(annotate("error", decision.reason));
    return 1;
  }

  const apiKey = /** @type {string} */ (valueOf(env, "NEON_API_KEY"));
  const projectId = /** @type {string} */ (valueOf(env, "NEON_PROJECT_ID"));
  const repository = valueOf(env, "REPOSITORY") ?? "";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    log(annotate("error", "REPOSITORY is not an owner/name repository."));
    return 1;
  }

  let selected;
  try {
    // Read both lists before deleting anything, so a failure deletes nothing.
    const [openPulls, branches] = await Promise.all([
      listOpenPulls({
        fetch,
        repository,
        token: valueOf(env, "GITHUB_TOKEN"),
      }),
      listNeonBranches({ fetch, projectId, apiKey }),
    ]);
    // GitHub can still list the closing pull request as open when its close
    // event fires. Counting it would keep its own branch for ever.
    const closing =
      decision.mode === "close"
        ? Number(valueOf(env, "PR_NUMBER"))
        : Number.NaN;
    const openHeadRefs = openPulls
      .filter((pull) => pull.number !== closing)
      .map((pull) => pull.ref);
    selected =
      decision.mode === "close"
        ? selectBranchesForClose(branches, env.HEAD_REF, openHeadRefs)
        : selectBranchesToSweep(branches, openHeadRefs);
    if (decision.mode === "close" && selected.length === 0) {
      const name = /** @type {string} */ (previewBranchName(env.HEAD_REF));
      log(
        openHeadRefs.includes(/** @type {string} */ (env.HEAD_REF))
          ? `Kept ${printable(name)}: another open pull request uses the same git branch.`
          : `No deletable Neon branch named ${printable(name)}. Nothing to delete.`,
      );
    }
    if (decision.mode === "sweep") {
      log(
        `${selected.length} of ${branches.length} Neon branches are preview branches with no open pull request.`,
      );
    }
  } catch (error) {
    log(
      annotate(
        "error",
        error instanceof ApiError
          ? `${error.message} Nothing was deleted.`
          : "The cleanup failed before deleting anything.",
      ),
    );
    return 1;
  }

  let failures = 0;
  for (const branch of selected) {
    try {
      const outcome = await deleteNeonBranch({
        fetch,
        projectId,
        apiKey,
        branch,
      });
      log(
        outcome === "deleted"
          ? `Deleted ${printable(branch.name)}.`
          : `${printable(branch.name)} was already gone.`,
      );
    } catch (error) {
      failures += 1;
      log(
        annotate(
          "error",
          error instanceof ApiError
            ? error.message
            : `Deleting ${printable(branch.name)} failed.`,
        ),
      );
    }
  }
  return failures === 0 ? 0 : 1;
}

function writeOutput(line) {
  const file = process.env.GITHUB_OUTPUT;
  if (typeof file === "string" && file !== "") {
    appendFileSync(file, `${line}\n`);
  } else {
    console.log(line);
  }
}

async function main(argv) {
  const [command] = argv;
  switch (command) {
    case "decide": {
      const decision = decideCleanup(process.env);
      if (decision.action === "skip") {
        console.log(annotate("notice", decision.reason));
        writeOutput("proceed=false");
        return 0;
      }
      if (decision.action === "fail") {
        console.log(annotate("error", decision.reason));
        writeOutput("proceed=false");
        return 1;
      }
      console.log(decision.reason);
      writeOutput("proceed=true");
      return 0;
    }
    case "clean":
      return clean(process.env, {
        fetch: globalThis.fetch,
        log: (line) => console.log(line),
      });
    default:
      console.error("Usage: neon-preview-cleanup.mjs decide | clean");
      return 1;
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await main(process.argv.slice(2));
}
