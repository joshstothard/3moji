#!/usr/bin/env node
// Every decision the nightly database backup makes (#206), as pure functions,
// with a thin command line for .github/workflows/backup.yml to call. Tested in
// scripts/backup-plan.test.mjs; the workflow itself is guarded by
// scripts/backup-workflow-guard.test.mjs.
//
// - `decide`: skip until the owner sets BACKUPS_ENABLED=true, so a scheduled
//   run before setup is green and quiet. Once enabled, fail naming every
//   missing or malformed secret or variable. Writes `proceed=true|false` to
//   $GITHUB_OUTPUT.
// - `key`: the R2 object key for a dump taken now.
// - `check-size <file>`: fail an empty or truncated dump; print its size.
// - `check-upload <local> <remote>`: fail unless the uploaded object is the
//   local file's size.
//
// This repository and its Actions logs are public. Nothing here prints a
// value: a message names a setting, never what it holds. The workflow never
// echoes these names itself, which is why the names are printed from here.

import { appendFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repository secrets the workflow reads. */
export const SECRET_NAMES = Object.freeze([
  "BACKUP_DATABASE_URL",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
]);

/** Repository variables the workflow reads. Variables are not masked in logs. */
export const VARIABLE_NAMES = Object.freeze([
  "R2_ACCOUNT_ID",
  "R2_BUCKET",
  "BACKUP_AGE_RECIPIENT",
]);

export const CONFIG_NAMES = Object.freeze([...SECRET_NAMES, ...VARIABLE_NAMES]);

/**
 * The smallest encrypted dump accepted. Measured on 2026-09-14 with pg_dump's
 * custom format and `--no-owner --no-privileges`: an empty database dumps to
 * 837 bytes, and this repository's schema with every migration applied and no
 * rows to 20,455 bytes. age adds a few hundred. So a dump under this is of an
 * empty or wrong database, or no dump at all.
 */
export const MIN_DUMP_BYTES = 4096;

/**
 * Values to register with `::add-mask::` before the dump runs. pg_dump's
 * connection errors quote the host and the user, and GitHub masks a secret
 * only where its whole value appears, so a failed run would otherwise print
 * part of the connection string. Values with a line break are left out: they
 * would end the workflow command early.
 *
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {string[]}
 */
export function valuesToMask(env) {
  const value = valueOf(env, "BACKUP_DATABASE_URL");
  if (value === undefined) return [];
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return [];
  }
  const candidates = [url.hostname];
  try {
    candidates.push(decodeURIComponent(url.username));
  } catch {
    // An undecodable user name cannot be what pg_dump prints; nothing to add.
  }
  return candidates.filter((v) => v !== "" && !/[\r\n]/.test(v));
}

const OBJECT_PREFIX = "3moji";

/** An age X25519 recipient: `age1` and 58 bech32 characters. */
const AGE_RECIPIENT = /^age1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}$/;
const AGE_PRIVATE_KEY = /^AGE-SECRET-KEY-1/i;
/** Cloudflare account IDs are 32 hex characters. Anything else could redirect the endpoint host. */
const R2_ACCOUNT_ID = /^[0-9a-f]{32}$/i;
/** R2 bucket names: 3 to 63 lowercase letters, digits and hyphens, not starting or ending with a hyphen. */
const R2_BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/** A present, non-blank value, or undefined. */
function valueOf(env, name) {
  const value = env[name];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * Why a present value is unusable, naming the setting but never its value, or
 * undefined if it is usable.
 */
function malformed(name, value) {
  switch (name) {
    case "BACKUP_DATABASE_URL": {
      let url;
      try {
        url = new URL(value.trim());
      } catch {
        return "BACKUP_DATABASE_URL is not a connection string.";
      }
      if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
        return "BACKUP_DATABASE_URL is not a postgres:// or postgresql:// connection string.";
      }
      if (/-pooler(\.|$)/i.test(url.hostname)) {
        return "BACKUP_DATABASE_URL is Neon's pooled connection. pg_dump needs the direct connection: in Neon, turn connection pooling off and copy the string again.";
      }
      return undefined;
    }
    case "BACKUP_AGE_RECIPIENT":
      if (AGE_PRIVATE_KEY.test(value.trim())) {
        return "BACKUP_AGE_RECIPIENT holds an age private key, not the public key. Repository variables are not masked, so treat that key as exposed: delete the variable, make a new key with age-keygen, and set only its public key (age1...).";
      }
      return AGE_RECIPIENT.test(value.trim())
        ? undefined
        : "BACKUP_AGE_RECIPIENT is not an age public key (age1 followed by 58 characters).";
    case "R2_ACCOUNT_ID":
      return R2_ACCOUNT_ID.test(value.trim())
        ? undefined
        : "R2_ACCOUNT_ID is not a Cloudflare account ID (32 hexadecimal characters).";
    case "R2_BUCKET":
      return R2_BUCKET.test(value.trim())
        ? undefined
        : "R2_BUCKET is not a valid R2 bucket name (3 to 63 lowercase letters, digits and hyphens).";
    default:
      return undefined;
  }
}

/**
 * Whether tonight's backup should run.
 *
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {{ action: "skip" | "fail" | "run", reason: string, missing: string[] }}
 */
export function decideBackup(env) {
  const enabled = (env.BACKUPS_ENABLED ?? "").trim().toLowerCase() === "true";
  if (!enabled) {
    return {
      action: "skip",
      reason:
        "BACKUPS_ENABLED is not true, so no backup was taken. Set it once setup is done: docs/owner-actions.md, Where nightly database backups are stored.",
      missing: [],
    };
  }

  const missing = CONFIG_NAMES.filter(
    (name) => valueOf(env, name) === undefined,
  );
  if (missing.length > 0) {
    return {
      action: "fail",
      reason: `Backups are enabled but these are not set: ${missing.join(", ")}. Add them in Settings, Secrets and variables, Actions.`,
      missing,
    };
  }

  const problems = CONFIG_NAMES.map((name) =>
    malformed(name, env[name]),
  ).filter((problem) => problem !== undefined);
  if (problems.length > 0) {
    return { action: "fail", reason: problems.join(" "), missing: [] };
  }

  return {
    action: "run",
    reason: "Backups are enabled and configured.",
    missing: [],
  };
}

const pad = (n, width = 2) => String(n).padStart(width, "0");

/** The R2 object key for a dump taken at `date`, in UTC. */
export function objectKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError("objectKey needs a valid Date.");
  }
  const y = pad(date.getUTCFullYear(), 4);
  const m = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  const stamp = `${y}${m}${d}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  return `${OBJECT_PREFIX}/${y}/${m}/${d}/${OBJECT_PREFIX}-${stamp}.dump.age`;
}

/** Whether an encrypted dump of `bytes` is big enough to be a real dump. */
export function checkDumpSize(bytes, minimum = MIN_DUMP_BYTES) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    return { ok: false, reason: "The dump's size could not be read." };
  }
  if (bytes === 0) {
    return { ok: false, reason: "The dump is empty. Nothing was uploaded." };
  }
  if (bytes < minimum) {
    return {
      ok: false,
      reason: `The dump is ${bytes} bytes, smaller than the ${minimum}-byte minimum, so it cannot hold the database. Nothing was uploaded.`,
    };
  }
  return { ok: true, reason: `The dump is ${bytes} bytes.` };
}

/** A whole, non-negative byte count from a number or a CLI string, or undefined. */
function bytesOf(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  }
  if (typeof value !== "string" || !/^\s*\d+\s*$/.test(value)) return undefined;
  const n = Number(value.trim());
  return Number.isSafeInteger(n) ? n : undefined;
}

/** Whether the uploaded object is exactly the local file's size. */
export function checkUploadedSize(local, remote) {
  const localBytes = bytesOf(local);
  const remoteBytes = bytesOf(remote);
  if (localBytes === undefined) {
    return { ok: false, reason: "The local dump's size could not be read." };
  }
  if (remoteBytes === undefined) {
    return {
      ok: false,
      reason:
        "The uploaded object's size could not be read, so the upload is not confirmed.",
    };
  }
  if (localBytes !== remoteBytes) {
    return {
      ok: false,
      reason: `The uploaded object is ${remoteBytes} bytes but the dump is ${localBytes} bytes. The upload is incomplete.`,
    };
  }
  return { ok: true, reason: `Uploaded and confirmed: ${remoteBytes} bytes.` };
}

/** One-line GitHub annotation text: no newlines, which would end the command. */
const annotate = (level, message) =>
  `::${level}::${message.replace(/\r?\n/g, " ")}`;

function writeOutput(line) {
  const file = process.env.GITHUB_OUTPUT;
  if (typeof file === "string" && file !== "") {
    appendFileSync(file, `${line}\n`);
  } else {
    console.log(line);
  }
}

function main(argv) {
  const [command, ...args] = argv;

  switch (command) {
    case "decide": {
      const decision = decideBackup(process.env);
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
      // Before anything else is printed, and before pg_dump can quote them.
      for (const value of valuesToMask(process.env)) {
        console.log(`::add-mask::${value}`);
      }
      console.log(decision.reason);
      writeOutput("proceed=true");
      return 0;
    }
    case "key":
      console.log(objectKey(new Date()));
      return 0;
    case "check-size": {
      let bytes = Number.NaN;
      try {
        bytes = statSync(args[0] ?? "").size;
      } catch {
        console.log(
          annotate(
            "error",
            "The dump file does not exist. Nothing was uploaded.",
          ),
        );
        return 1;
      }
      const result = checkDumpSize(bytes);
      if (!result.ok) {
        console.log(annotate("error", result.reason));
        return 1;
      }
      console.log(String(bytes));
      return 0;
    }
    case "check-upload": {
      const result = checkUploadedSize(args[0], args[1]);
      console.log(result.ok ? result.reason : annotate("error", result.reason));
      return result.ok ? 0 : 1;
    }
    default:
      console.error(
        "Usage: backup-plan.mjs decide | key | check-size <file> | check-upload <local-bytes> <remote-bytes>",
      );
      return 1;
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2));
}
