#!/usr/bin/env node
//
// Asserts that this checkout actually has git hooks installed (#119).
//
// ## The failure this guards against
//
// Three facts combine into a window in which a checkout can commit with *no
// hooks at all* and nothing says so:
//
// 1. husky sets `core.hooksPath` by running, in `husky/index.js`:
//
//        git config core.hooksPath .husky/_
//
//    Note the **relative** path, and note the absent `--worktree`. A relative
//    `core.hooksPath` resolves against each worktree's own root, so every
//    worktree looks for its *own* `.husky/_`.
//
// 2. `.husky/_` is generated, not tracked. It is written by husky via the
//    `prepare` script and is gitignored (`.husky/_/.gitignore` contains `*`).
//    Only `.husky/pre-commit` and `.husky/pre-push` are committed. A newly
//    created worktree therefore has no `.husky/_` until `npm install` has
//    completed *in that worktree*.
//
// 3. Git ignores a missing `core.hooksPath` **silently**. Measured in a
//    throwaway repo:
//
//        git init -q . && git config core.hooksPath .husky/_
//        git commit -m "commit with a hooksPath that does not exist"
//        # -> exit 0, no warning, commit created
//
//    Nothing distinguishes "hooks ran and passed" from "there were no hooks".
//
// This is not hypothetical. PR #118 merged two unformatted files to `main`
// because its agent's hooks never ran, and at the time formatting had no
// server-side gate at all. `secretlint` in pre-commit still has no server-side
// counterpart, and this repository is public — a leaked credential is
// compromised the moment it is pushed.
//
// ## Why it asserts on the *resolved* directory
//
// The check asks git where hooks actually resolve to, rather than looking for
// `.husky/_` directly:
//
//     git rev-parse --git-path hooks
//
// That honours `core.hooksPath` (verified: in a repo with `core.hooksPath` set
// to a non-existent `.husky/_`, it prints `.husky/_`, not `.git/hooks`). So the
// check is agnostic to *how* the repo is configured. That matters here, because
// `core.hooksPath` is not always the relative value husky writes — a checkout
// may carry an absolute path to a shared `.husky/_`, either repo-wide or as a
// per-worktree `config.worktree` override. Both are legitimate, working states,
// and a check that looked for `.husky/_` in the worktree root would report a
// false failure against them.
//
// ## Why it asserts existence, not the executable bit
//
// The agent report on PR #118 blamed a missing executable bit. Issue #119
// records that as **not reproducible** — `.husky/_/pre-commit` is `-rwxr-xr-x`
// in every agent worktree checked. Asserting on the mode would re-introduce the
// cause the issue went out of its way to correct, and would fail on Windows
// checkouts where the bit is not meaningful.
//
// ## Why it is not a no-op in CI
//
// It deliberately makes the same assertion on a GitHub Actions runner rather
// than skipping. `.github/actions/setup` runs a bare `npm install`, npm runs the
// root `prepare` script, and husky's only bail-outs are `HUSKY=0` and a missing
// `.git`. So hooks are genuinely installed in CI, the assertion is live there,
// and it catches a real regression: an `--ignore-scripts` or `HUSKY=0` creeping
// into the setup action would silently stop installing hooks for everyone, and
// this is what would notice.
//
// Note *which* CI jobs carry it. `scripts/verify.sh` is not itself a CI job --
// CI runs the steps individually -- so the `verify:hooks` CLI never runs on a
// runner. The assertion reaches CI through two jobs that do use the setup
// action: `agent-workflow-parity` (which runs verify-agent-workflow.mjs, where
// this is asserted) and `script-tests` (whose final case asserts the running
// checkout has hooks). Failing both on a husky regression is intended, not
// accidental duplication: one is the parity gate, the other is this module's
// own test.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// The hook git consults before it will let a commit through. `pre-commit` is
// the one that runs lint-staged, and so prettier and secretlint.
const REQUIRED_HOOK = "pre-commit";

/**
 * Ask git where hooks resolve to for this checkout.
 *
 * `git rev-parse --git-path` prints a path relative to the *invocation* cwd, so
 * the result is resolved against the cwd we passed rather than
 * `process.cwd()` — otherwise running the check from a subdirectory silently
 * points it at the wrong place.
 *
 * @param {string} cwd
 * @returns {{ hooksDir: string | null, hooksPath: string | null, error: string | null }}
 */
export function resolveHooksDir(cwd) {
  const revParse = spawnSync("git", ["rev-parse", "--git-path", "hooks"], {
    cwd,
    encoding: "utf8",
  });
  if (revParse.error) {
    return { hooksDir: null, hooksPath: null, error: revParse.error.message };
  }
  if (revParse.status !== 0) {
    return {
      hooksDir: null,
      hooksPath: null,
      error: (revParse.stderr || "").trim() || "git rev-parse failed",
    };
  }
  const printed = revParse.stdout.trim();

  const configured = spawnSync("git", ["config", "--get", "core.hooksPath"], {
    cwd,
    encoding: "utf8",
  });

  return {
    hooksDir: path.resolve(cwd, printed),
    hooksPath:
      configured.status === 0 ? configured.stdout.trim() || null : null,
    error: null,
  };
}

/**
 * @param {{ cwd?: string }} [options]
 * @returns {{ ok: boolean, skipped: boolean, hooksDir: string | null, hooksPath: string | null, message: string }}
 */
export function checkGitHooks({ cwd = repoRoot } = {}) {
  const { hooksDir, hooksPath, error } = resolveHooksDir(cwd);

  if (error !== null) {
    // Not a git repository (a source tarball, an exported build context). There
    // are no hooks to install and no commits to guard, so there is nothing to
    // assert. Skipping is reported out loud rather than passing quietly.
    return {
      ok: true,
      skipped: true,
      hooksDir: null,
      hooksPath: null,
      message:
        `Git hooks check skipped: ${cwd} is not a git repository ` +
        `(git said: ${error}). Nothing can commit from here, so there is ` +
        `nothing to guard.`,
    };
  }

  const hookFile = path.join(hooksDir, REQUIRED_HOOK);
  if (fs.existsSync(hookFile)) {
    return {
      ok: true,
      skipped: false,
      hooksDir,
      hooksPath,
      message:
        `Git hooks installed: ${hookFile} exists ` +
        `(core.hooksPath = ${hooksPath ?? "<unset>"}).`,
    };
  }

  const configLine =
    hooksPath === null
      ? `core.hooksPath is unset, so git is using ${hooksDir}`
      : `core.hooksPath is "${hooksPath}", which resolves to ${hooksDir}`;

  return {
    ok: false,
    skipped: false,
    hooksDir,
    hooksPath,
    message: [
      `Git hooks are NOT installed in this checkout.`,
      ``,
      `  ${configLine},`,
      `  but that directory has no "${REQUIRED_HOOK}".`,
      ``,
      `Git ignores a missing core.hooksPath silently: commits succeed with`,
      `exit 0 and no warning, so nothing would have told you. In this repo`,
      `pre-commit is what runs prettier and secretlint, and secretlint has no`,
      `server-side counterpart on a public repository.`,
      ``,
      `To fix, run in THIS checkout:`,
      ``,
      `    npm install          # or, if dependencies are already present:`,
      `    npm run prepare`,
      ``,
      `One caveat before you do, if this is a git worktree. husky installs by`,
      `running "git config core.hooksPath .husky/_" with no --worktree, so it`,
      `writes a RELATIVE path into the shared .git/config that every worktree`,
      `reads. If this repo currently carries an absolute core.hooksPath (the`,
      `value above will show it), running prepare here replaces it for every`,
      `worktree — and any sibling worktree without its own .husky/_ then loses`,
      `its hooks. To fix only this checkout and leave the others alone, set a`,
      `worktree-local override instead (extensions.worktreeConfig is on):`,
      ``,
      `    git config --worktree core.hooksPath /absolute/path/to/.husky/_`,
      ``,
      `See issue #119.`,
    ].join("\n"),
  };
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  const result = checkGitHooks();
  if (result.ok) {
    console.log(result.message);
  } else {
    console.error(result.message);
    process.exit(1);
  }
}
