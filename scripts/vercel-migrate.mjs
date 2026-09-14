#!/usr/bin/env node
// Applies the committed Drizzle migrations during a Vercel build, before
// `next build` (#32, ADR-0006 decision 6, ADR-0010 decision 2).
//
// It is run from `apps/web/vercel.json`'s buildCommand and from nowhere else:
// not from any package.json `build` script and not as a turbo task. So a local
// `npm run build` and CI's build job never reach it, and Turborepo's strict env
// mode does not filter the variables it reads. A turbo task could also be
// skipped on a remote cache hit, which a migration must never be.
//
// The decision is a pure function of the environment, so every rule below is
// tested without a database (scripts/vercel-migrate.test.mjs):
//
// - No `VERCEL_ENV`: skip. This is not a Vercel build.
// - A `VERCEL_ENV` other than production or preview: fail, rather than guess
//   which database it means.
// - No `DATABASE_URL_UNPOOLED`: fail. drizzle.config.ts would otherwise fall
//   back to the pooled `DATABASE_URL`, which on a preview whose Neon branch was
//   not created is the Preview-scoped value, not a branch.
// - Preview: fail unless `PRODUCTION_DATABASE_HOST` is set and neither
//   connection string's host is that host. The Neon integration injects each
//   preview's branch credentials at deployment time and names no branch in
//   any variable, so comparing against production is the only check that can
//   tell. Without it, it cannot tell, and fails safe.
// - Otherwise: run `drizzle-kit migrate` in packages/core. Its exit status is
//   the build's, so a failing migration fails the deployment.
//
// Nothing here prints a connection string, a host, or any other value.

import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const KNOWN_ENVIRONMENTS = ["production", "preview"];

/** A present, non-empty value, or undefined. */
function valueOf(env, name) {
  const value = env[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The host of a connection string, lower-cased, or undefined if unparseable. */
function hostOf(connectionString) {
  try {
    const host = new URL(connectionString).hostname;
    return host === "" ? undefined : host.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * One Neon endpoint has a direct host and a pooled host that differ only by
 * `-pooler` on the first label, so both spellings name the same database.
 */
function endpointOf(host) {
  const [first, ...rest] = host.toLowerCase().split(".");
  return [first.replace(/-pooler$/, ""), ...rest].join(".");
}

/**
 * What the build should do about migrations.
 *
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {{ action: "skip" | "run" | "fail", reason: string }}
 */
export function decideMigration(env) {
  const vercelEnv = valueOf(env, "VERCEL_ENV");
  if (vercelEnv === undefined) {
    return {
      action: "skip",
      reason:
        "VERCEL_ENV is not set, so this is not a Vercel build. Skipping migrations.",
    };
  }

  if (!KNOWN_ENVIRONMENTS.includes(vercelEnv)) {
    return {
      action: "fail",
      reason: `VERCEL_ENV is not one of ${KNOWN_ENVIRONMENTS.join(" or ")}, so it is unclear which database to migrate. Refusing.`,
    };
  }

  const unpooled = valueOf(env, "DATABASE_URL_UNPOOLED");
  if (unpooled === undefined) {
    return {
      action: "fail",
      reason:
        "DATABASE_URL_UNPOOLED is not set. Migrations need the direct connection and never fall back to DATABASE_URL. Check the Neon integration is connected for this environment.",
    };
  }

  const unpooledHost = hostOf(unpooled);
  if (unpooledHost === undefined) {
    return {
      action: "fail",
      reason:
        "DATABASE_URL_UNPOOLED is not a parseable connection string. Refusing.",
    };
  }

  if (vercelEnv === "preview") {
    const production = valueOf(env, "PRODUCTION_DATABASE_HOST");
    if (production === undefined) {
      return {
        action: "fail",
        reason:
          "PRODUCTION_DATABASE_HOST is not set for Preview, so this build cannot prove it is not about to migrate the production database. Refusing. See docs/owner-actions.md.",
      };
    }

    const pooled = valueOf(env, "DATABASE_URL");
    const hosts = [
      unpooledHost,
      pooled === undefined ? undefined : hostOf(pooled),
    ];
    if (
      hosts.some(
        (host) =>
          host !== undefined && endpointOf(host) === endpointOf(production),
      )
    ) {
      return {
        action: "fail",
        reason:
          "This preview's database connection is the production database: the Neon preview branch was not injected for this deployment. Refusing, so a preview cannot touch production data.",
      };
    }
  }

  return {
    action: "run",
    reason: `Applying committed migrations for ${vercelEnv} against DATABASE_URL_UNPOOLED.`,
  };
}

function main() {
  const decision = decideMigration(process.env);
  const prefix = "[vercel-migrate]";

  if (decision.action === "skip") {
    console.log(`${prefix} skip: ${decision.reason}`);
    return 0;
  }
  if (decision.action === "fail") {
    console.error(`${prefix} fail: ${decision.reason}`);
    return 1;
  }

  console.log(`${prefix} ${decision.reason}`);
  const core = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "packages",
    "core",
  );
  const result = spawnSync("npx", ["--no-install", "drizzle-kit", "migrate"], {
    cwd: core,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error !== undefined) {
    console.error(
      `${prefix} fail: could not start drizzle-kit (${result.error.name}).`,
    );
    return 1;
  }
  return result.status ?? 1;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main();
}
