// Guards .github/workflows/backup.yml (#206). Run with `npm run test:scripts`.
//
// This repository and its Actions logs and artifacts are public (AGENTS.md
// § This Repository Is Public). The backup workflow handles the production
// connection string, R2 credentials and a dump of every Account, so the ways
// it could leak are checked here, on the workflow as text:
//
// - no dump is uploaded as an Actions artifact, which anyone can download;
// - no shell trace (`set -x`) prints the commands with their values expanded;
// - no `echo` or `printf` names a secret or variable;
// - no `${{ }}` expression is pasted into a script, where a value would become
//   shell text; secrets and variables reach a script only through `env:`;
// - `pg_dump` is piped straight into `age`, under `set -euo pipefail`, so the
//   dump is never on disk unencrypted and a failed dump fails the run;
// - the job runs only on this repository's main branch, with read-only
//   permissions, and removes the encrypted dump even when a step fails.
//
// Each rule is also run against a small bad workflow, so a rule that could
// never fail is caught here rather than trusted.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { CONFIG_NAMES } from "./backup-plan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = path.join(root, ".github", "workflows", "backup.yml");

/** Joins shell line continuations, so a command split with `\` reads as one line. */
const joinContinuations = (text) => text.replace(/\\\n\s*/g, " ");

/**
 * The body of every `run:` in the workflow, as { step, script }. `step` is the
 * whole step's text, so a rule can read its `if:` and `env:` too.
 */
export function runBlocks(text) {
  const steps = text.split(/\n(?=\s*- (?:name|uses|run|id):)/);
  const blocks = [];
  for (const step of steps) {
    // Horizontal space only: `\s` would cross the newline after `run: |` and
    // swallow the script's first line as if it were an inline command.
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
export function problems(text) {
  const found = [];
  const blocks = runBlocks(text);

  if (/upload-artifact/.test(text)) {
    found.push("uses actions/upload-artifact");
  }
  if (/\bset\s+-[a-z]*x|\bset\s+-o\s+xtrace|\bbash\s+-[a-z]*x\b/.test(text)) {
    found.push("turns on shell tracing");
  }

  for (const rawLine of joinContinuations(text).split("\n")) {
    if (!/\b(echo|printf)\b/.test(rawLine)) continue;
    const named = CONFIG_NAMES.filter((name) => rawLine.includes(name));
    if (named.length > 0) found.push(`echoes ${named.join(", ")}`);
  }

  for (const { script } of blocks) {
    if (script.includes("${{")) {
      found.push("pastes a ${{ }} expression into a run script");
    }
  }

  // `pg_dump --version` in the install step is a check, not a dump.
  const dumps = blocks.filter(({ script }) =>
    /\bpg_dump\b(?!\s+--version\b)/.test(script),
  );
  if (dumps.length === 0) found.push("never runs pg_dump");
  for (const { step, script } of dumps) {
    const joined = joinContinuations(script);
    const pipe = joined
      .split("\n")
      .find((line) => /\bpg_dump\b[^|]*\|\s*age\b/.test(line));
    if (pipe === undefined) {
      found.push("runs pg_dump without piping it straight into age");
      continue;
    }
    for (const flag of ["--format=custom", "--no-owner", "--no-privileges"]) {
      if (!pipe.includes(flag)) found.push(`pg_dump is missing ${flag}`);
    }
    // Any process on the runner can read a command line, so the password goes
    // in a libpq password file and pg_dump gets the string without it.
    if (/BACKUP_DATABASE_URL/.test(pipe)) {
      found.push(
        "pg_dump is given the connection string, password included, on its command line",
      );
    }
    if (!/PGPASSFILE/.test(step) || !/backup-plan\.mjs pgpass\b/.test(script)) {
      found.push(
        "pg_dump does not read its password from a libpq password file",
      );
    }
    if (!/(--recipient|-r)\s+"\$BACKUP_AGE_RECIPIENT"/.test(pipe)) {
      found.push("age does not encrypt to BACKUP_AGE_RECIPIENT");
    }
    if (!/\bset -euo pipefail\b/.test(script)) {
      found.push("the pg_dump step does not set -euo pipefail");
    }
    if (!/RUNNER_TEMP/.test(script)) {
      found.push("the dump is not written under $RUNNER_TEMP");
    }
    if (!/steps\.decide\.outputs\.proceed == 'true'/.test(step)) {
      found.push("the pg_dump step is not gated on the decide step");
    }
  }

  const uploads = blocks.filter(({ script }) => /\baws\s+s3/.test(script));
  if (uploads.length === 0) found.push("never uploads with the AWS CLI");
  for (const { step, script } of uploads) {
    if (!/head-object/.test(script) || !/check-upload/.test(script)) {
      found.push(
        "the upload is not verified with head-object and check-upload",
      );
    }
    if (!/steps\.decide\.outputs\.proceed == 'true'/.test(step)) {
      found.push("the upload step is not gated on the decide step");
    }
  }

  if (!/postgresql-client-18\b/.test(text)) {
    found.push("does not install postgresql-client-18");
  }
  if (!/node scripts\/backup-plan\.mjs decide/.test(text)) {
    found.push("does not ask scripts/backup-plan.mjs whether to proceed");
  }
  if (!/node scripts\/backup-plan\.mjs check-size/.test(text)) {
    found.push("does not check the dump's size");
  }
  if (
    !/^\s*schedule:\s*$/m.test(text) ||
    !/^\s*workflow_dispatch:\s*$/m.test(text)
  ) {
    found.push("is not both scheduled and manually runnable");
  }
  // Every `permissions:` value, top-level or job-level, inline or as an
  // indented block, with comments removed: a comment is not a permission.
  const permissionValues = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const match = line.match(/^([ \t]*)permissions:[ \t]*(.*)$/);
    if (match === null) return;
    const [, indent, inline] = match;
    const value = [inline.replace(/#.*$/, "")];
    for (const next of lines.slice(index + 1)) {
      if (next.trim() === "") continue;
      if (next.search(/\S/) <= indent.length) break;
      value.push(next.replace(/#.*$/, ""));
    }
    permissionValues.push(value.join("\n"));
  });
  if (
    !/^permissions:[ \t]*\n[ \t]+contents:[ \t]*read[ \t]*$/m.test(text) ||
    permissionValues.some((value) => /\bwrite/.test(value))
  ) {
    found.push("permissions are not contents: read only");
  }
  if (
    !/github\.repository == 'joshstothard\/3moji'/.test(text) ||
    !/github\.ref == 'refs\/heads\/main'/.test(text)
  ) {
    found.push("is not restricted to main on joshstothard/3moji");
  }
  const cleanup = blocks.find(
    ({ step, script }) =>
      /if:\s*always\(\)/.test(step) && /\brm\b[^\n]*RUNNER_TEMP/.test(script),
  );
  if (cleanup === undefined) {
    found.push(
      "does not remove the dump from $RUNNER_TEMP in an always() step",
    );
  }

  return found;
}

const GOOD = `
name: Nightly database backup
on:
  schedule:
    - cron: "17 3 * * *"
  workflow_dispatch:
permissions:
  contents: read
jobs:
  backup:
    if: github.repository == 'joshstothard/3moji' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: Decide
        id: decide
        run: node scripts/backup-plan.mjs decide
      - name: Install
        if: steps.decide.outputs.proceed == 'true'
        run: sudo apt-get install -y postgresql-client-18 age
      - name: Dump
        if: steps.decide.outputs.proceed == 'true'
        env:
          BACKUP_DATABASE_URL: \${{ secrets.BACKUP_DATABASE_URL }}
        run: |
          set -euo pipefail
          dbname="$(node scripts/backup-plan.mjs pgpass "$RUNNER_TEMP/x.pgpass")"
          PGPASSFILE="$RUNNER_TEMP/x.pgpass" /usr/lib/postgresql/18/bin/pg_dump --format=custom --no-owner --no-privileges \\
            --dbname="$dbname" \\
            | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$RUNNER_TEMP/x.dump.age"
          node scripts/backup-plan.mjs check-size "$RUNNER_TEMP/x.dump.age"
      - name: Upload
        if: steps.decide.outputs.proceed == 'true'
        run: |
          set -euo pipefail
          aws s3api put-object --bucket "$R2_BUCKET" --key k --body f > /dev/null
          remote=$(aws s3api head-object --bucket "$R2_BUCKET" --key k --query ContentLength --output text)
          node scripts/backup-plan.mjs check-upload 1 "$remote"
      - name: Remove
        if: always()
        run: rm -f "$RUNNER_TEMP/x.dump.age"
`;

describe("the backup workflow guard, against known-bad workflows", () => {
  it("passes the minimal good workflow, so the rules below fail for their own reason", () => {
    assert.deepEqual(problems(GOOD), []);
  });

  // The permissions rule reads permissions blocks, not the whole file, so a
  // comment cannot trip it: the `set -x` rule was tripped by a comment once.
  it("does not mistake a comment that mentions write for a write permission", () => {
    const commented = GOOD.replace(
      "jobs:\n",
      "# The R2 token's permission: write, on one bucket only.\njobs:\n",
    );
    assert.deepEqual(problems(commented), []);
  });

  it("fails a job-level write permission", () => {
    const jobWrite = GOOD.replace(
      "    runs-on: ubuntu-latest\n",
      "    runs-on: ubuntu-latest\n    permissions:\n      contents: write\n",
    );
    assert.ok(
      problems(jobWrite).some((p) => /permissions/.test(p)),
      JSON.stringify(problems(jobWrite)),
    );
  });

  it("fails a connection string with its password on pg_dump's command line", () => {
    const onCommandLine = GOOD.replace(
      '--dbname="$dbname"',
      '--dbname="$BACKUP_DATABASE_URL"',
    );
    assert.notEqual(onCommandLine, GOOD, "the fixture did not change");
    assert.ok(
      problems(onCommandLine).some((p) => /password/.test(p)),
      JSON.stringify(problems(onCommandLine)),
    );
  });

  it("fails a dump that does not read its password from a libpq password file", () => {
    const noPassfile = GOOD.replace('PGPASSFILE="$RUNNER_TEMP/x.pgpass" ', "");
    assert.notEqual(noPassfile, GOOD, "the fixture did not change");
    assert.ok(
      problems(noPassfile).some((p) => /password file/.test(p)),
      JSON.stringify(problems(noPassfile)),
    );
  });

  it("fails permissions: write-all", () => {
    const writeAll = GOOD.replace(
      "    runs-on: ubuntu-latest\n",
      "    runs-on: ubuntu-latest\n    permissions: write-all\n",
    );
    assert.ok(
      problems(writeAll).some((p) => /permissions/.test(p)),
      JSON.stringify(problems(writeAll)),
    );
  });

  const bad = [
    [
      "an artifact upload",
      GOOD.replace(
        "      - name: Remove",
        "      - uses: actions/upload-artifact@v7\n      - name: Remove",
      ),
      /upload-artifact/,
    ],
    [
      "set -x",
      GOOD.replace(
        "set -euo pipefail\n          dbname=",
        "set -euxo pipefail\n          dbname=",
      ),
      /tracing/,
    ],
    [
      "set -o xtrace",
      GOOD.replace("run: rm -f", "run: set -o xtrace; rm -f"),
      /tracing/,
    ],
    [
      "echo of a secret",
      GOOD.replace("run: rm -f", 'run: echo "$BACKUP_DATABASE_URL"; rm -f'),
      /echoes BACKUP_DATABASE_URL/,
    ],
    [
      "printf of a variable",
      GOOD.replace("run: rm -f", "run: printf '%s' \"$R2_BUCKET\"; rm -f"),
      /echoes R2_BUCKET/,
    ],
    [
      "an expression pasted into a script",
      GOOD.replace('"$dbname" \\', '"${{ secrets.BACKUP_DATABASE_URL }}" \\'),
      /expression/,
    ],
    [
      "pg_dump to a file, not age",
      GOOD.replace("| age --encrypt", "> plain.dump; age --encrypt"),
      /straight into age/,
    ],
    [
      "pg_dump without --no-owner",
      GOOD.replace(" --no-owner", ""),
      /--no-owner/,
    ],
    [
      "no pipefail",
      GOOD.replace(
        "set -euo pipefail\n          dbname=",
        "set -eu\n          dbname=",
      ),
      /pipefail/,
    ],
    [
      "an ungated dump",
      GOOD.replace(
        "      - name: Dump\n        if: steps.decide.outputs.proceed == 'true'\n",
        "      - name: Dump\n",
      ),
      /pg_dump step is not gated/,
    ],
    ["no head-object check", GOOD.replace(/remote=.*\n/, ""), /head-object/],
    [
      "the wrong client",
      GOOD.replace("postgresql-client-18", "postgresql-client-16"),
      /postgresql-client-18/,
    ],
    [
      "a write permission",
      GOOD.replace("contents: read", "contents: write"),
      /permissions/,
    ],
    [
      "no fork guard",
      GOOD.replace("github.repository == 'joshstothard/3moji' && ", ""),
      /restricted/,
    ],
    [
      "no always() cleanup",
      GOOD.replace("if: always()", "if: success()"),
      /always\(\)/,
    ],
    ["no schedule", GOOD.replace(/  schedule:\n.*\n/, ""), /scheduled/],
  ];

  for (const [label, workflow, expected] of bad) {
    it(`fails ${label}`, () => {
      const found = problems(workflow);
      assert.ok(
        found.some((problem) => expected.test(problem)),
        `expected a problem matching ${expected}, got ${JSON.stringify(found)}`,
      );
    });
  }
});

describe(".github/workflows/backup.yml", () => {
  it("exists", () => {
    assert.ok(existsSync(WORKFLOW), "missing .github/workflows/backup.yml");
  });

  it("breaks none of the rules", () => {
    const text = readFileSync(WORKFLOW, "utf8");
    assert.deepEqual(problems(text), []);
  });

  it("reads every secret from secrets and every variable from vars, never the reverse", () => {
    const text = readFileSync(WORKFLOW, "utf8");
    for (const name of [
      "BACKUP_DATABASE_URL",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
    ]) {
      assert.match(text, new RegExp(`secrets\\.${name}\\b`), name);
      assert.doesNotMatch(text, new RegExp(`vars\\.${name}\\b`), name);
    }
    for (const name of [
      "R2_ACCOUNT_ID",
      "R2_BUCKET",
      "BACKUP_AGE_RECIPIENT",
      "BACKUPS_ENABLED",
    ]) {
      assert.match(text, new RegExp(`vars\\.${name}\\b`), name);
      assert.doesNotMatch(text, new RegExp(`secrets\\.${name}\\b`), name);
    }
  });
});
