// Tests for scripts/backup-plan.mjs. Run with `npm run test:scripts`.
//
// The nightly backup workflow (.github/workflows/backup.yml, #206) asks this
// module every question that has a right answer, so the answers are tested
// here without a database, a bucket or a runner. Written from the issue and
// the orchestrator's brief, not from the implementation:
//
// - until the owner sets BACKUPS_ENABLED=true, the run is a successful no-op,
//   so there are no nightly red runs before setup;
// - once enabled, every missing secret or variable fails the run and is named,
//   and no value is ever printed;
// - an empty or truncated dump fails the run rather than being uploaded;
// - the uploaded object must be the size of the local file.
//
// Every value below is a placeholder on example.com, and the output tests
// assert that none of them is ever printed.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

import {
  CONFIG_NAMES,
  MIN_DUMP_BYTES,
  checkDumpSize,
  checkUploadedSize,
  decideBackup,
  objectKey,
  valuesToMask,
} from "./backup-plan.mjs";

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "backup-plan.mjs",
);

const SECRET_PASSWORD = "not-a-real-password";
// Assembled, so no scanner mistakes a placeholder for a real age private key.
const PRIVATE_KEY_SHAPED =
  ["AGE", "SECRET", "KEY", "1"].join("-") + "Q".repeat(58);

const VALID = Object.freeze({
  BACKUP_DATABASE_URL: `postgresql://backup:${SECRET_PASSWORD}@ep-prod-123.db.example.com/app?sslmode=require`,
  R2_ACCESS_KEY_ID: "example-access-key-id-not-real",
  R2_SECRET_ACCESS_KEY: "example-secret-access-key-not-real",
  R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_BUCKET: "3moji-backups-example",
  BACKUP_AGE_RECIPIENT: `age1${"q".repeat(58)}`,
});

const enabled = (overrides = {}) => ({
  BACKUPS_ENABLED: "true",
  ...VALID,
  ...overrides,
});

/** `text` without GitHub's add-mask commands, which the runner never logs. */
const withoutMaskCommands = (text) =>
  text
    .split("\n")
    .filter((line) => !line.startsWith("::add-mask::"))
    .join("\n");

/** Asserts no configured value, or any part of the password, is logged in `text`. */
function assertNoValues(text, env = enabled()) {
  const logged = withoutMaskCommands(text);
  for (const [name, value] of Object.entries(env)) {
    if (name === "BACKUPS_ENABLED" || typeof value !== "string" || value === "")
      continue;
    assert.ok(!logged.includes(value), `${name}'s value was printed`);
  }
  assert.ok(!logged.includes(SECRET_PASSWORD), "the password was printed");
  assert.ok(
    !logged.includes("db.example.com"),
    "the database host was printed",
  );
}

// pg_dump's connection errors quote the host and the user, and GitHub masks a
// secret only where the whole value appears, so a failed dump would print part
// of the connection string. decide registers both as masks first.
describe("valuesToMask", () => {
  it("masks the database host and user, which pg_dump quotes in its errors", () => {
    assert.deepEqual(valuesToMask(enabled()), [
      "ep-prod-123.db.example.com",
      "backup",
    ]);
  });

  it("decodes a percent-encoded user, as pg_dump would print it", () => {
    const env = enabled({
      BACKUP_DATABASE_URL:
        "postgresql://neon%2Bowner:pw@ep-1.db.example.com/app",
    });
    assert.deepEqual(valuesToMask(env), ["ep-1.db.example.com", "neon+owner"]);
  });

  it("masks nothing it cannot parse, and never a value that would break the command", () => {
    assert.deepEqual(valuesToMask({}), []);
    assert.deepEqual(valuesToMask({ BACKUP_DATABASE_URL: "not a url" }), []);
    assert.deepEqual(
      valuesToMask({
        BACKUP_DATABASE_URL: "postgresql://a%0Ab:pw@h.example.com/app",
      }),
      ["h.example.com"],
    );
  });

  it("is registered by decide before any other output, and only when the run proceeds", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "backup-plan-mask-206-"));
    try {
      const decide = (env) =>
        spawnSync(process.execPath, [script, "decide"], {
          encoding: "utf8",
          env: {
            PATH: process.env.PATH,
            GITHUB_OUTPUT: path.join(dir, "out"),
            ...env,
          },
        }).stdout;

      const lines = decide(enabled()).trim().split("\n");
      assert.equal(lines[0], "::add-mask::ep-prod-123.db.example.com");
      assert.equal(lines[1], "::add-mask::backup");
      assert.ok(!decide({}).includes("::add-mask::"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("decideBackup", () => {
  it("lists exactly the three secrets and three variables the workflow reads", () => {
    assert.deepEqual([...CONFIG_NAMES].sort(), [
      "BACKUP_AGE_RECIPIENT",
      "BACKUP_DATABASE_URL",
      "R2_ACCESS_KEY_ID",
      "R2_ACCOUNT_ID",
      "R2_BUCKET",
      "R2_SECRET_ACCESS_KEY",
    ]);
  });

  it("skips successfully until BACKUPS_ENABLED is true, even with nothing configured", () => {
    for (const BACKUPS_ENABLED of [
      undefined,
      "",
      "false",
      "0",
      "yes",
      "enabled",
    ]) {
      const decision = decideBackup({ BACKUPS_ENABLED });
      assert.equal(decision.action, "skip", String(BACKUPS_ENABLED));
      assert.match(decision.reason, /BACKUPS_ENABLED/);
    }
  });

  it("skips without naming config, so a disabled run does not read as broken", () => {
    const decision = decideBackup({});
    for (const name of CONFIG_NAMES) {
      assert.ok(!decision.reason.includes(name), name);
    }
  });

  it("treats true in any case, with surrounding space, as enabled", () => {
    for (const BACKUPS_ENABLED of ["true", "TRUE", " True "]) {
      assert.equal(decideBackup(enabled({ BACKUPS_ENABLED })).action, "run");
    }
  });

  it("proceeds when enabled and everything is configured", () => {
    const decision = decideBackup(enabled());
    assert.equal(decision.action, "run");
    assert.deepEqual(decision.missing, []);
  });

  it("fails naming all six when enabled with nothing configured", () => {
    const decision = decideBackup({ BACKUPS_ENABLED: "true" });
    assert.equal(decision.action, "fail");
    assert.deepEqual(decision.missing, [...CONFIG_NAMES]);
    for (const name of CONFIG_NAMES) {
      assert.match(decision.reason, new RegExp(`\\b${name}\\b`));
    }
  });

  it("fails naming exactly the one missing setting", () => {
    for (const name of CONFIG_NAMES) {
      for (const absent of [undefined, "", "   "]) {
        const decision = decideBackup(enabled({ [name]: absent }));
        assert.equal(decision.action, "fail", `${name}=${String(absent)}`);
        assert.deepEqual(decision.missing, [name]);
        for (const other of CONFIG_NAMES.filter((n) => n !== name)) {
          assert.ok(
            !decision.reason.includes(other),
            `${name}: named ${other}`,
          );
        }
        assertNoValues(decision.reason);
      }
    }
  });

  it("refuses a connection string that is not postgres, without printing it", () => {
    for (const BACKUP_DATABASE_URL of [
      "not a url",
      // No credentials: secretlint rightly refuses any connection-string shape.
      "https://db.example.com/app",
    ]) {
      const env = enabled({ BACKUP_DATABASE_URL });
      const decision = decideBackup(env);
      assert.equal(decision.action, "fail");
      assert.match(decision.reason, /BACKUP_DATABASE_URL/);
      assertNoValues(decision.reason, env);
    }
  });

  it("refuses Neon's pooled connection, because pg_dump needs the direct one", () => {
    const env = enabled({
      BACKUP_DATABASE_URL: `postgresql://backup:${SECRET_PASSWORD}@ep-prod-123-pooler.db.example.com/app?sslmode=require`,
    });
    const decision = decideBackup(env);
    assert.equal(decision.action, "fail");
    assert.match(decision.reason, /BACKUP_DATABASE_URL/);
    assert.match(decision.reason, /pool/i);
    assertNoValues(decision.reason, env);
  });

  it("refuses a recipient that is not an age public key", () => {
    for (const BACKUP_AGE_RECIPIENT of [
      "age1short",
      "ssh-ed25519 AAAA",
      `age1${"b".repeat(58)}`,
    ]) {
      const decision = decideBackup(enabled({ BACKUP_AGE_RECIPIENT }));
      assert.equal(decision.action, "fail", BACKUP_AGE_RECIPIENT);
      assert.match(decision.reason, /BACKUP_AGE_RECIPIENT/);
      assert.ok(!decision.reason.includes(BACKUP_AGE_RECIPIENT));
    }
  });

  it("says to rotate when the recipient holds a private key, and never prints it", () => {
    const decision = decideBackup(
      enabled({ BACKUP_AGE_RECIPIENT: PRIVATE_KEY_SHAPED }),
    );
    assert.equal(decision.action, "fail");
    assert.match(decision.reason, /private key/i);
    assert.match(decision.reason, /new key/i);
    assert.ok(!decision.reason.includes(PRIVATE_KEY_SHAPED));
    assert.ok(!decision.reason.includes("Q".repeat(12)));
  });

  it("refuses an account ID that could not be an R2 account, so it cannot redirect the endpoint", () => {
    for (const R2_ACCOUNT_ID of [
      "abc",
      "evil.example.com/x",
      "0123456789abcdef0123456789abcdeg",
    ]) {
      const decision = decideBackup(enabled({ R2_ACCOUNT_ID }));
      assert.equal(decision.action, "fail", R2_ACCOUNT_ID);
      assert.match(decision.reason, /R2_ACCOUNT_ID/);
    }
  });

  it("refuses a bucket name R2 would not accept", () => {
    for (const R2_BUCKET of [
      "ab",
      "Upper-Case",
      "has_underscore",
      "-leading",
      "a".repeat(64),
    ]) {
      const decision = decideBackup(enabled({ R2_BUCKET }));
      assert.equal(decision.action, "fail", R2_BUCKET);
      assert.match(decision.reason, /R2_BUCKET/);
    }
  });
});

describe("objectKey", () => {
  it("names the object by UTC date and timestamp under the 3moji prefix", () => {
    assert.equal(
      objectKey(new Date("2026-09-14T03:17:05.123Z")),
      "3moji/2026/09/14/3moji-20260914T031705Z.dump.age",
    );
  });

  it("zero-pads every field and uses UTC, not the runner's zone", () => {
    assert.equal(
      objectKey(new Date("2027-01-02T23:04:09Z")),
      "3moji/2027/01/02/3moji-20270102T230409Z.dump.age",
    );
  });

  it("throws on an invalid date rather than naming an object NaN", () => {
    assert.throws(() => objectKey(new Date("not a date")));
  });
});

describe("checkDumpSize", () => {
  it("fails an empty dump", () => {
    const result = checkDumpSize(0);
    assert.equal(result.ok, false);
    assert.match(result.reason, /empty|small/i);
  });

  it("fails anything below the minimum, and passes the minimum", () => {
    assert.equal(checkDumpSize(MIN_DUMP_BYTES - 1).ok, false);
    assert.equal(checkDumpSize(MIN_DUMP_BYTES).ok, true);
    assert.equal(checkDumpSize(50_000_000).ok, true);
  });

  it("has a minimum that an age header over nothing cannot reach", () => {
    // age's header and an empty payload are a few hundred bytes.
    assert.ok(MIN_DUMP_BYTES >= 1024);
  });

  it("fails a size that is not a whole number of bytes", () => {
    for (const bytes of [Number.NaN, -1, 1.5, Infinity]) {
      assert.equal(checkDumpSize(bytes).ok, false, String(bytes));
    }
  });
});

describe("checkUploadedSize", () => {
  it("passes when the object is exactly the local size, as numbers or strings", () => {
    assert.equal(checkUploadedSize(40_960, 40_960).ok, true);
    assert.equal(checkUploadedSize("40960", "40960\n").ok, true);
  });

  it("fails when the sizes differ", () => {
    const result = checkUploadedSize(40_960, 40_959);
    assert.equal(result.ok, false);
    assert.match(result.reason, /40960/);
    assert.match(result.reason, /40959/);
  });

  it("fails when the object's size could not be read", () => {
    for (const remote of ["", "None", undefined, "abc"]) {
      assert.equal(checkUploadedSize(40_960, remote).ok, false, String(remote));
    }
  });
});

describe("the command line", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "backup-plan-206-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  let outputs = 0;
  const run = (args, env = {}) => {
    outputs += 1;
    const output = path.join(dir, `github-output-${outputs}`);
    writeFileSync(output, "");
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, ...env },
    });
    return {
      status: result.status,
      text: `${result.stdout}${result.stderr}`,
      output: readFileSync(output, "utf8"),
    };
  };

  it("decide: a disabled run exits 0 with a notice and proceed=false", () => {
    const result = run(["decide"]);
    assert.equal(result.status, 0);
    assert.match(result.text, /::notice/);
    assert.match(result.output, /^proceed=false$/m);
  });

  it("decide: an enabled run with a missing secret exits 1 with an error naming it", () => {
    const env = enabled({ R2_SECRET_ACCESS_KEY: "" });
    const result = run(["decide"], env);
    assert.equal(result.status, 1);
    assert.match(result.text, /::error/);
    assert.match(result.text, /R2_SECRET_ACCESS_KEY/);
    assert.ok(!/^proceed=true$/m.test(result.output));
    assertNoValues(result.text, env);
  });

  it("decide: a configured run exits 0 with proceed=true and prints no value", () => {
    const result = run(["decide"], enabled());
    assert.equal(result.status, 0);
    assert.match(result.output, /^proceed=true$/m);
    assertNoValues(result.text);
    assertNoValues(result.output);
  });

  it("key: prints one object key", () => {
    const result = run(["key"]);
    assert.equal(result.status, 0);
    assert.match(
      result.text.trim(),
      /^3moji\/\d{4}\/\d{2}\/\d{2}\/3moji-\d{8}T\d{6}Z\.dump\.age$/,
    );
  });

  it("check-size: fails a small file, a missing file, and passes a big enough one", () => {
    const small = path.join(dir, "small.dump.age");
    const big = path.join(dir, "big.dump.age");
    writeFileSync(small, Buffer.alloc(MIN_DUMP_BYTES - 1));
    writeFileSync(big, Buffer.alloc(MIN_DUMP_BYTES));

    assert.equal(run(["check-size", small]).status, 1);
    assert.equal(run(["check-size", path.join(dir, "absent")]).status, 1);
    const ok = run(["check-size", big]);
    assert.equal(ok.status, 0);
    assert.match(ok.text.trim(), new RegExp(`^${MIN_DUMP_BYTES}$`, "m"));
  });

  it("check-upload: exits 1 on a size mismatch and 0 on a match", () => {
    assert.equal(run(["check-upload", "5000", "4999"]).status, 1);
    assert.equal(run(["check-upload", "5000", "None"]).status, 1);
    assert.equal(run(["check-upload", "5000", "5000"]).status, 0);
  });

  it("exits 1 on an unknown command", () => {
    assert.equal(run(["upload-everything"]).status, 1);
    assert.equal(run([]).status, 1);
  });
});
