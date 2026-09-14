// Guards .github/workflows/neon-preview-cleanup.yml (#258). Run with
// `npm run test:scripts`.
//
// This repository and its Actions logs are public (AGENTS.md § This Repository
// Is Public). The cleanup workflow holds a Neon API key that can delete
// database branches, so the ways it could leak the key or delete the wrong
// thing are checked here, on the workflow as text:
//
// - it never uses `pull_request_target`, which would run with secrets for a
//   pull request from a fork;
// - no shell trace (`set -x`) prints commands with their values expanded;
// - no `echo` or `printf` names the key, the project or the switch;
// - no `${{ }}` expression is pasted into a script, where an attacker-chosen
//   branch name would become shell text; values reach a script through `env:`;
// - nothing in the workflow deletes a branch itself (no `curl`, no `neonctl`,
//   no third-party action): every delete goes through
//   scripts/neon-preview-cleanup.mjs, whose tests prove it deletes only
//   `preview/` branches;
// - it sweeps on a schedule, because the auto-merge gate's merges raise no
//   pull_request event;
// - it runs only on this repository, a manual run only from main, with
//   read-only permissions, and the delete step is gated on the decide step.
//
// Each rule is also run against a small bad workflow, so a rule that could
// never fail is caught here rather than trusted.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = path.join(
  root,
  ".github",
  "workflows",
  "neon-preview-cleanup.yml",
);

/** Names whose values must never be printed. */
const SENSITIVE_NAMES = [
  "NEON_API_KEY",
  "NEON_PROJECT_ID",
  "NEON_CLEANUP_ENABLED",
  "GITHUB_TOKEN",
];

/** Joins shell line continuations, so a command split with `\` reads as one line. */
const joinContinuations = (text) => text.replace(/\\\n\s*/g, " ");

/** The workflow with every comment removed, so a comment can never trip or satisfy a rule. */
const withoutComments = (text) =>
  text
    .split("\n")
    .map((line) => line.replace(/(^|\s)#.*$/, ""))
    .join("\n");

/**
 * The body of every `run:` in the workflow, as { step, script }. `step` is the
 * whole step's text, so a rule can read its `if:` and `env:` too.
 */
function runBlocks(text) {
  const steps = text.split(/\n(?=\s*- (?:name|uses|run|id):)/);
  const blocks = [];
  for (const step of steps) {
    // Horizontal space only: `\s` would cross the newline after `run: |`.
    const match = step.match(
      /^([ \t]*)(?:- )?run:[ \t]*(\|[-+]?|>[-+]?)?[ \t]*(.*)$/m,
    );
    if (match === null) continue;
    const [line, indent, block, inline] = match;
    if (block === undefined) {
      blocks.push({ step, script: inline });
      continue;
    }
    const after = step.slice(step.indexOf(line) + line.length).split("\n");
    const lines = [];
    for (const l of after.slice(1)) {
      if (l.trim() !== "" && l.search(/\S/) <= indent.length) break;
      lines.push(l);
    }
    blocks.push({ step, script: lines.join("\n") });
  }
  return blocks;
}

/** Every rule the workflow must satisfy, as a list of problems (empty = fine). */
export function problems(raw) {
  const found = [];
  const text = withoutComments(raw);
  const blocks = runBlocks(text);

  if (/pull_request_target/.test(text)) {
    found.push("uses pull_request_target");
  }
  if (
    !/^\s*pull_request:\s*\n\s*types:\s*\[\s*closed\s*\]\s*$/m.test(text) ||
    !/^\s*workflow_dispatch:\s*$/m.test(text)
  ) {
    found.push("does not run on pull_request closed and workflow_dispatch");
  }
  // The auto-merge gate's merges raise no pull_request event, so only a
  // scheduled sweep cleans up after them.
  if (!/^\s*schedule:\s*\n\s*-\s*cron:\s*["'][^"'\n]+["']\s*$/m.test(text)) {
    found.push("does not sweep on a schedule");
  }
  if (/\bset\s+-[a-z]*x|\bset\s+-o\s+xtrace|\bbash\s+-[a-z]*x\b/.test(text)) {
    found.push("turns on shell tracing");
  }

  for (const line of joinContinuations(text).split("\n")) {
    if (!/\b(echo|printf)\b/.test(line)) continue;
    const named = SENSITIVE_NAMES.filter((name) => line.includes(name));
    if (named.length > 0) found.push(`echoes ${named.join(", ")}`);
  }

  for (const { script } of blocks) {
    if (script.includes("${{")) {
      found.push("pastes a ${{ }} expression into a run script");
    }
    if (/\b(curl|wget|neonctl|gh\s+api)\b/.test(script)) {
      found.push(
        "calls an API from a run script instead of scripts/neon-preview-cleanup.mjs",
      );
    }
  }
  if (/uses:\s*neondatabase\//.test(text)) {
    found.push(
      "deletes through a third-party action instead of scripts/neon-preview-cleanup.mjs",
    );
  }
  const actions = [...text.matchAll(/uses:\s*([^\s]+)/g)].map((m) => m[1]);
  for (const action of actions) {
    if (!/^actions\/(checkout|setup-node)@/.test(action)) {
      found.push(
        `uses an action other than checkout and setup-node: ${action}`,
      );
    }
  }

  if (!/node scripts\/neon-preview-cleanup\.mjs decide\b/.test(text)) {
    found.push(
      "does not ask scripts/neon-preview-cleanup.mjs whether to proceed",
    );
  }
  const cleans = blocks.filter(({ script }) =>
    /node scripts\/neon-preview-cleanup\.mjs clean\b/.test(script),
  );
  if (cleans.length === 0) {
    found.push("never runs scripts/neon-preview-cleanup.mjs clean");
  }
  for (const { step } of cleans) {
    if (!/steps\.decide\.outputs\.proceed == 'true'/.test(step)) {
      found.push("the clean step is not gated on the decide step");
    }
  }

  if (
    !/secrets\.NEON_API_KEY\b/.test(text) ||
    /vars\.NEON_API_KEY\b/.test(text)
  ) {
    found.push("does not read NEON_API_KEY from secrets");
  }
  for (const name of ["NEON_PROJECT_ID", "NEON_CLEANUP_ENABLED"]) {
    if (!new RegExp(`vars\\.${name}\\b`).test(text)) {
      found.push(`does not read ${name} from vars`);
    }
  }
  if (!/HEAD_REF:\s*\$\{\{\s*github\.head_ref\s*\}\}/.test(text)) {
    found.push("does not pass the head ref through env");
  }
  if (
    !/PR_NUMBER:\s*\$\{\{\s*github\.event\.pull_request\.number\s*\}\}/.test(
      text,
    )
  ) {
    found.push("does not pass the closing pull request's number through env");
  }

  // Every `permissions:` value, top-level or job-level, inline or as a block.
  const lines = text.split("\n");
  const permissionValues = [];
  lines.forEach((line, index) => {
    const match = line.match(/^([ \t]*)permissions:[ \t]*(.*)$/);
    if (match === null) return;
    const [, indent, inline] = match;
    const value = [inline];
    for (const next of lines.slice(index + 1)) {
      if (next.trim() === "") continue;
      if (next.search(/\S/) <= indent.length) break;
      value.push(next);
    }
    permissionValues.push(value.join("\n"));
  });
  if (
    !/^permissions:[ \t]*\n(?:[ \t]+[a-z-]+:[ \t]*read[ \t]*\n)*[ \t]+contents:[ \t]*read[ \t]*$/m.test(
      text,
    ) ||
    permissionValues.some((value) => /\bwrite/.test(value))
  ) {
    found.push("permissions are not read-only with contents: read");
  }

  if (!/github\.repository == 'joshstothard\/3moji'/.test(text)) {
    found.push("is not restricted to joshstothard/3moji");
  }
  if (!/github\.ref == 'refs\/heads\/main'/.test(text)) {
    found.push("a manual run is not restricted to main");
  }
  if (!/persist-credentials:\s*false/.test(text)) {
    found.push("checkout keeps the token in the git config");
  }

  return found;
}

const GOOD = `
name: Neon preview cleanup
on:
  pull_request:
    types: [closed]
  workflow_dispatch:
  schedule:
    - cron: "23 * * * *"
permissions:
  contents: read
  pull-requests: read
jobs:
  cleanup:
    if: github.repository == 'joshstothard/3moji' && (github.event_name == 'pull_request' || github.ref == 'refs/heads/main')
    runs-on: ubuntu-latest
    env:
      NEON_CLEANUP_ENABLED: \${{ vars.NEON_CLEANUP_ENABLED }}
      NEON_API_KEY: \${{ secrets.NEON_API_KEY }}
      NEON_PROJECT_ID: \${{ vars.NEON_PROJECT_ID }}
      HEAD_REF: \${{ github.head_ref }}
      PR_NUMBER: \${{ github.event.pull_request.number }}
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: actions/setup-node@v7
      - name: Decide
        id: decide
        run: node scripts/neon-preview-cleanup.mjs decide
      - name: Delete
        if: steps.decide.outputs.proceed == 'true'
        run: node scripts/neon-preview-cleanup.mjs clean
`;

describe("the Neon preview cleanup workflow guard, against known-bad workflows", () => {
  it("passes the minimal good workflow, so the rules below fail for their own reason", () => {
    assert.deepEqual(problems(GOOD), []);
  });

  it("is not tripped by a comment that names pull_request_target or set -x", () => {
    const commented = GOOD.replace(
      "jobs:\n",
      "# Never pull_request_target, and never set -x.\njobs:\n",
    );
    assert.deepEqual(problems(commented), []);
  });

  const bad = [
    [
      "pull_request_target",
      GOOD.replace("  pull_request:\n", "  pull_request_target:\n"),
      /pull_request_target/,
    ],
    [
      "a pull_request trigger for every activity type",
      GOOD.replace("    types: [closed]\n", ""),
      /pull_request closed/,
    ],
    ["no schedule", GOOD.replace(/  schedule:\n.*\n/, ""), /schedule/],
    [
      "no manual run",
      GOOD.replace("  workflow_dispatch:\n", ""),
      /workflow_dispatch/,
    ],
    [
      "set -x",
      GOOD.replace(
        "run: node scripts/neon-preview-cleanup.mjs clean",
        "run: set -x; node scripts/neon-preview-cleanup.mjs clean",
      ),
      /tracing/,
    ],
    [
      "set -o xtrace",
      GOOD.replace(
        "run: node scripts/neon-preview-cleanup.mjs clean",
        "run: set -o xtrace; node scripts/neon-preview-cleanup.mjs clean",
      ),
      /tracing/,
    ],
    [
      "echo of the key",
      GOOD.replace(
        "run: node scripts/neon-preview-cleanup.mjs clean",
        'run: echo "$NEON_API_KEY"; node scripts/neon-preview-cleanup.mjs clean',
      ),
      /echoes NEON_API_KEY/,
    ],
    [
      "printf of the project",
      GOOD.replace(
        "run: node scripts/neon-preview-cleanup.mjs clean",
        "run: printf '%s' \"$NEON_PROJECT_ID\"; node scripts/neon-preview-cleanup.mjs clean",
      ),
      /echoes NEON_PROJECT_ID/,
    ],
    [
      "the head ref pasted into a script",
      GOOD.replace(
        "run: node scripts/neon-preview-cleanup.mjs clean",
        'run: node scripts/neon-preview-cleanup.mjs clean "${{ github.head_ref }}"',
      ),
      /expression/,
    ],
    [
      "a curl delete",
      GOOD.replace(
        "run: node scripts/neon-preview-cleanup.mjs clean",
        'run: curl -X DELETE -H "Authorization: Bearer $NEON_API_KEY" "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches/main"; node scripts/neon-preview-cleanup.mjs clean',
      ),
      /calls an API/,
    ],
    [
      "neonctl",
      GOOD.replace(
        "run: node scripts/neon-preview-cleanup.mjs clean",
        "run: npx neonctl branches delete main; node scripts/neon-preview-cleanup.mjs clean",
      ),
      /calls an API/,
    ],
    [
      "the Neon delete-branch action",
      GOOD.replace(
        "      - name: Decide\n",
        "      - uses: neondatabase/delete-branch-action@v3\n      - name: Decide\n",
      ),
      /third-party action/,
    ],
    [
      "an ungated clean step",
      GOOD.replace("        if: steps.decide.outputs.proceed == 'true'\n", ""),
      /not gated/,
    ],
    [
      "no clean step",
      GOOD.replace(
        "        run: node scripts/neon-preview-cleanup.mjs clean\n",
        "        run: node scripts/neon-preview-cleanup.mjs decide\n",
      ),
      /never runs/,
    ],
    [
      "the key read from vars",
      GOOD.replace("secrets.NEON_API_KEY", "vars.NEON_API_KEY"),
      /NEON_API_KEY from secrets/,
    ],
    [
      "a write permission",
      GOOD.replace("contents: read", "contents: write"),
      /permissions/,
    ],
    [
      "a job-level write permission",
      GOOD.replace(
        "    runs-on: ubuntu-latest\n",
        "    runs-on: ubuntu-latest\n    permissions:\n      pull-requests: write\n",
      ),
      /permissions/,
    ],
    [
      "permissions: write-all",
      GOOD.replace(
        "    runs-on: ubuntu-latest\n",
        "    runs-on: ubuntu-latest\n    permissions: write-all\n",
      ),
      /permissions/,
    ],
    [
      "no closing pull request number",
      GOOD.replace(
        "      PR_NUMBER: ${{ github.event.pull_request.number }}\n",
        "",
      ),
      /pull request's number/,
    ],
    [
      "no repository guard",
      GOOD.replace("github.repository == 'joshstothard/3moji' && ", ""),
      /restricted to joshstothard/,
    ],
    [
      "a manual run from any branch",
      GOOD.replace(" || github.ref == 'refs/heads/main'", " || true"),
      /restricted to main/,
    ],
    [
      "checkout that keeps credentials",
      GOOD.replace("persist-credentials: false", "persist-credentials: true"),
      /keeps the token/,
    ],
  ];

  for (const [label, workflow, expected] of bad) {
    it(`fails ${label}`, () => {
      assert.notEqual(workflow, GOOD, "the fixture did not change");
      const found = problems(workflow);
      assert.ok(
        found.some((problem) => expected.test(problem)),
        `expected a problem matching ${expected}, got ${JSON.stringify(found)}`,
      );
    });
  }
});

describe(".github/workflows/neon-preview-cleanup.yml", () => {
  it("exists", () => {
    assert.ok(
      existsSync(WORKFLOW),
      "missing .github/workflows/neon-preview-cleanup.yml",
    );
  });

  it("breaks none of the rules", () => {
    assert.ok(existsSync(WORKFLOW), "missing workflow");
    assert.deepEqual(problems(readFileSync(WORKFLOW, "utf8")), []);
  });
});
