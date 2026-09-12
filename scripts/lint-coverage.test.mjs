// Asserts that `npm run lint` actually covers every workspace. Run with
// `npm run test:scripts`.
//
// `npm run lint` is `turbo lint`, which runs each workspace's own `lint`
// script. A workspace without one is not an error — turbo skips it in silence,
// so the repo's standards (`strictTypeChecked`, no `any`, the unused-vars rule)
// simply never reach it. `packages/shared` sat in that state from creation
// until #40: shared types, Zod schemas and constants that both the domain and
// the web app import, never once linted, locally or in CI.
//
// The check is made against `turbo run lint --dry=json` rather than against the
// presence of a `lint` script in each `package.json`, because the silence
// happens at the pipeline layer and has more than one cause. Turbo emits a task
// entry for every workspace and reports `"command": "<NONEXISTENT>"` when there
// is no script behind it, so a script that was never added, one that is deleted,
// and a workspace dropped from the `workspaces` globs all surface here — a
// file-presence check catches only the first.
//
// Exemptions live in LINT_EXEMPT below, with a reason each. That is the point of
// the allowlist: a predicate tuned to pass against today's tree ("packages with
// TypeScript under src/") could never fail, whereas a new package that ships no
// lint script has to be argued for in this file, in the diff, where a reviewer
// sees it.

import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Workspaces that legitimately have no `lint` script, and why. Adding an entry
// here is a deliberate, reviewable act; adding a package without one is not.
const LINT_EXEMPT = {
  // Ships `*.json` only (base/nestjs/nextjs/react-library). ESLint has nothing
  // to parse.
  "@template/tsconfig": "JSON only — no JavaScript or TypeScript source",
  // Its source is flat-config `.mjs` at the package root, not TypeScript under
  // `src`. The shared config it would extend is `strictTypeChecked` with
  // `parserOptions.project`, which cannot type-check a file that belongs to no
  // tsconfig, so linting it needs a separate non-type-checked config rather
  // than the one-line pattern the other packages use. Tracked as its own work.
  "@template/eslint-config": "flat-config .mjs source at the package root",
  // Same shape and same reason: Jest presets as `.js` at the package root.
  "@template/jest-config": "Jest preset .js source at the package root",
};

function turboLintTasks() {
  const turbo = path.join(root, "node_modules", ".bin", "turbo");
  const result = spawnSync(turbo, ["run", "lint", "--dry=json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `turbo run lint --dry=json failed:\n${result.stderr ?? ""}`,
  );
  // Turbo prints a version banner before the JSON document.
  const start = result.stdout.indexOf("{");
  assert.notEqual(start, -1, "turbo produced no JSON document");
  const plan = JSON.parse(result.stdout.slice(start));
  const tasks = plan.tasks.filter((task) => task.task === "lint");
  assert.ok(tasks.length > 0, "turbo planned no lint tasks at all");
  return { packages: plan.packages, tasks };
}

describe("npm run lint covers every workspace", () => {
  it("plans a real lint command for every non-exempt workspace", () => {
    const { tasks } = turboLintTasks();
    const skipped = tasks
      .filter((task) => task.command === "<NONEXISTENT>")
      .map((task) => task.package)
      .filter((name) => !(name in LINT_EXEMPT))
      .sort();
    assert.deepEqual(
      skipped,
      [],
      `turbo lint silently skips ${String(skipped.length)} workspace(s): ${skipped.join(", ")}. ` +
        "Add a `lint` script and an eslint.config.mjs to each, or add it to LINT_EXEMPT with a reason.",
    );
  });

  // Belt and braces, and honestly labelled: this one has never been observed
  // red, because turbo 2.x emits a task entry for every workspace whether or
  // not a script backs it — which is exactly what makes the assertion above
  // work. It cannot be driven red without changing turbo's behaviour, so it
  // carries no evidence today. It is kept because the assertion above reads
  // `<NONEXISTENT>` out of that task list: if a future turbo stopped emitting
  // entries for script-less workspaces, the check would silently pass over
  // them, and this is what would catch that.
  it("plans a lint task for every workspace, so none can go unaccounted for", () => {
    const { packages, tasks } = turboLintTasks();
    const planned = new Set(tasks.map((task) => task.package));
    const unaccounted = packages.filter((name) => !planned.has(name)).sort();
    assert.deepEqual(
      unaccounted,
      [],
      `workspaces absent from the lint task graph: ${unaccounted.join(", ")}`,
    );
  });

  it("has no stale exemptions", () => {
    const { packages, tasks } = turboLintTasks();
    const workspaces = new Set(packages);
    const missing = Object.keys(LINT_EXEMPT)
      .filter((name) => !workspaces.has(name))
      .sort();
    assert.deepEqual(
      missing,
      [],
      `LINT_EXEMPT names workspaces that no longer exist: ${missing.join(", ")}`,
    );
    const nowLinted = tasks
      .filter(
        (task) =>
          task.package in LINT_EXEMPT && task.command !== "<NONEXISTENT>",
      )
      .map((task) => task.package)
      .sort();
    assert.deepEqual(
      nowLinted,
      [],
      `LINT_EXEMPT still exempts workspaces that now lint: ${nowLinted.join(", ")}. Remove the entries.`,
    );
  });
});
