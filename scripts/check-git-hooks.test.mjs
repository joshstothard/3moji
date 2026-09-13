// Tests for scripts/check-git-hooks.mjs. Run with `npm run test:scripts`.
//
// The check exists because git will not tell you when hooks are missing, so the
// first test here is not of the check at all — it is of git, pinning the
// behaviour the check compensates for. If `git commit` ever starts warning
// about an unresolvable `core.hooksPath`, that test fails and this whole guard
// can be reconsidered.
//
// Everything runs against throwaway repositories under the OS temp directory.
// Nothing here touches the repository the tests are running in: a test that
// rewrote this checkout's `core.hooksPath` would be writing to the *shared*
// `.git/config` that every sibling worktree reads (see #119).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { after, describe, it } from "node:test";

import { checkGitHooks, resolveHooksDir } from "./check-git-hooks.mjs";

const scratchDirs = [];

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed in ${cwd}:\n${result.stderr ?? ""}`,
  );
  return result.stdout.trim();
}

/** A fresh, committed-into-able git repo in a temp directory. */
function makeRepo() {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "check-git-hooks-")),
  );
  scratchDirs.push(dir);
  git(dir, "init", "-q", ".");
  git(dir, "config", "user.email", "test@example.invalid");
  git(dir, "config", "user.name", "Test");
  return dir;
}

/** Create `<repo>/<relative>` and put a `pre-commit` in it. */
function installHooks(repo, relative) {
  const dir = path.join(repo, relative);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "pre-commit"),
    "#!/usr/bin/env sh\nexit 0\n",
    {
      mode: 0o755,
    },
  );
  return dir;
}

after(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("the git behaviour this check compensates for", () => {
  it("lets a commit through silently when core.hooksPath does not exist", () => {
    const repo = makeRepo();
    git(repo, "config", "core.hooksPath", ".husky/_");
    fs.writeFileSync(path.join(repo, "f.txt"), "hi\n");
    git(repo, "add", "f.txt");

    // Deliberately says nothing about hooks: git echoes the subject line back,
    // and the assertion below greps the output for the word.
    const commit = spawnSync("git", ["commit", "-m", "a commit"], {
      cwd: repo,
      encoding: "utf8",
    });

    assert.equal(
      commit.status,
      0,
      "expected git to accept the commit despite an unresolvable core.hooksPath",
    );
    assert.doesNotMatch(
      `${commit.stdout}${commit.stderr}`,
      /hooksPath|hook/i,
      "git mentioned hooks — if it now warns, this guard's premise has changed",
    );
  });
});

describe("resolveHooksDir", () => {
  it("honours core.hooksPath rather than reporting .git/hooks", () => {
    const repo = makeRepo();
    git(repo, "config", "core.hooksPath", ".husky/_");

    const { hooksDir, hooksPath, error } = resolveHooksDir(repo);

    assert.equal(error, null);
    assert.equal(hooksPath, ".husky/_");
    assert.equal(hooksDir, path.join(repo, ".husky", "_"));
  });

  it("resolves a relative hooksPath against the given cwd, not process.cwd()", () => {
    const repo = makeRepo();
    git(repo, "config", "core.hooksPath", ".husky/_");

    // process.cwd() is this repository, which is emphatically not `repo`.
    assert.notEqual(process.cwd(), repo);
    const { hooksDir } = resolveHooksDir(repo);

    assert.ok(
      hooksDir.startsWith(repo),
      `expected the hooks dir to live under ${repo}, got ${hooksDir}`,
    );
  });

  it("falls back to .git/hooks when core.hooksPath is unset", () => {
    const repo = makeRepo();

    const { hooksDir, hooksPath } = resolveHooksDir(repo);

    assert.equal(hooksPath, null);
    assert.equal(hooksDir, path.join(repo, ".git", "hooks"));
  });
});

describe("checkGitHooks", () => {
  it("fails when the resolved hooks directory has no pre-commit", () => {
    const repo = makeRepo();
    git(repo, "config", "core.hooksPath", ".husky/_");

    const result = checkGitHooks({ cwd: repo });

    assert.equal(result.ok, false);
    assert.equal(result.skipped, false);
    assert.match(result.message, /Git hooks are NOT installed/);
  });

  it("names the fix in its failure output", () => {
    const repo = makeRepo();
    git(repo, "config", "core.hooksPath", ".husky/_");

    const { message } = checkGitHooks({ cwd: repo });

    // Acceptance criterion 2 on #119: the output must say what to run.
    assert.match(message, /npm install/);
    assert.match(message, /npm run prepare/);
    // And it must warn that `prepare` rewrites the SHARED config, because husky
    // runs `git config core.hooksPath .husky/_` with no `--worktree`. Telling a
    // worktree to run prepare without that caveat is advice that breaks the
    // other worktrees.
    assert.match(message, /--worktree/);
  });

  it("reports the configured hooksPath in the failure, so the cause is visible", () => {
    const repo = makeRepo();
    git(repo, "config", "core.hooksPath", "some/where/else");

    const { message } = checkGitHooks({ cwd: repo });

    assert.match(message, /some\/where\/else/);
  });

  it("passes when the hooks directory contains pre-commit", () => {
    const repo = makeRepo();
    git(repo, "config", "core.hooksPath", ".husky/_");
    installHooks(repo, ".husky/_");

    const result = checkGitHooks({ cwd: repo });

    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    assert.match(result.message, /Git hooks installed/);
  });

  it("passes for an ABSOLUTE core.hooksPath pointing outside the checkout", () => {
    // A legitimate, working configuration: a worktree pointed at the main
    // checkout's `.husky/_`, which is what a `config.worktree` override does.
    // A check that looked for `.husky/_` in the worktree root would fail here.
    const main = makeRepo();
    const hooks = installHooks(main, ".husky/_");
    const other = makeRepo();
    git(other, "config", "core.hooksPath", hooks);

    const result = checkGitHooks({ cwd: other });

    assert.equal(result.ok, true);
    assert.equal(result.hooksDir, hooks);
  });

  it("passes on a stock repo whose .git/hooks has a real pre-commit", () => {
    const repo = makeRepo();
    fs.writeFileSync(
      path.join(repo, ".git", "hooks", "pre-commit"),
      "#!/usr/bin/env sh\nexit 0\n",
      { mode: 0o755 },
    );

    assert.equal(checkGitHooks({ cwd: repo }).ok, true);
  });

  it("fails on a stock repo with only git's .sample hooks", () => {
    // `git init` ships `pre-commit.sample`, which git never runs. The check must
    // not be fooled by it.
    const repo = makeRepo();
    assert.ok(
      fs.existsSync(path.join(repo, ".git", "hooks", "pre-commit.sample")),
      "expected git init to have written pre-commit.sample",
    );

    assert.equal(checkGitHooks({ cwd: repo }).ok, false);
  });

  it("skips out loud outside a git repository instead of passing quietly", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-git-hooks-bare-"));
    scratchDirs.push(dir);

    const result = checkGitHooks({ cwd: dir });

    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.match(result.message, /not a git repository/);
  });
});

describe("this repository", () => {
  it("has hooks installed (the assertion verify.sh and verify:agents make)", () => {
    const result = checkGitHooks();
    assert.ok(result.ok, result.message);
  });
});
