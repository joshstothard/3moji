// Tests for scripts/vercel-migrate.mjs. Run with `npm run test:scripts`.
//
// The script runs `drizzle-kit migrate` in the Vercel build command, before
// `next build` (#32, ADR-0006 decision 6). These tests are written from the
// issue's requirements, not from the implementation:
//
// - migrations run only on a Vercel build, never on a local or CI build;
// - they run against the unpooled connection, and never fall back to the
//   pooled one (drizzle.config.ts would, silently);
// - a preview build that would reach the production database fails instead.
//
// Nothing here opens a database connection. Every connection string is an
// example.com placeholder, and the message tests assert that no part of one is
// ever printed.

import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { decideMigration } from "./vercel-migrate.mjs";

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "vercel-migrate.mjs",
);

const SECRET = "not-a-real-password";
const PROD_HOST = "ep-prod-123.db.example.com";
const BRANCH_HOST = "ep-branch-456.db.example.com";

const url = (host, pooled = false) => {
  const [first, ...rest] = host.split(".");
  const h = pooled ? [`${first}-pooler`, ...rest].join(".") : host;
  return `postgresql://app:${SECRET}@${h}/app?sslmode=require`;
};

describe("decideMigration", () => {
  it("skips outside Vercel, so local and CI builds need no database", () => {
    assert.equal(decideMigration({}).action, "skip");
    assert.equal(decideMigration({ VERCEL_ENV: "" }).action, "skip");
    assert.equal(
      decideMigration({ DATABASE_URL_UNPOOLED: url(PROD_HOST) }).action,
      "skip",
    );
  });

  it("runs on a production build with the unpooled connection", () => {
    const decision = decideMigration({
      VERCEL_ENV: "production",
      DATABASE_URL_UNPOOLED: url(PROD_HOST),
      DATABASE_URL: url(PROD_HOST, true),
    });
    assert.equal(decision.action, "run");
  });

  it("fails a Vercel build with no unpooled connection, rather than migrating through the pooled one", () => {
    for (const VERCEL_ENV of ["production", "preview"]) {
      const decision = decideMigration({
        VERCEL_ENV,
        DATABASE_URL: url(PROD_HOST, true),
        PRODUCTION_DATABASE_HOST: PROD_HOST,
      });
      assert.equal(decision.action, "fail", VERCEL_ENV);
      assert.match(decision.reason, /DATABASE_URL_UNPOOLED/);
    }
  });

  it("fails an unrecognised VERCEL_ENV rather than guessing which database it means", () => {
    const decision = decideMigration({
      VERCEL_ENV: "development",
      DATABASE_URL_UNPOOLED: url(BRANCH_HOST),
    });
    assert.equal(decision.action, "fail");
    assert.match(decision.reason, /VERCEL_ENV/);
  });

  it("fails an unparseable unpooled connection string", () => {
    const decision = decideMigration({
      VERCEL_ENV: "production",
      DATABASE_URL_UNPOOLED: "not a url",
    });
    assert.equal(decision.action, "fail");
  });

  describe("on a preview", () => {
    it("runs against a database branch that is not production", () => {
      const decision = decideMigration({
        VERCEL_ENV: "preview",
        DATABASE_URL_UNPOOLED: url(BRANCH_HOST),
        DATABASE_URL: url(BRANCH_HOST, true),
        PRODUCTION_DATABASE_HOST: PROD_HOST,
      });
      assert.equal(decision.action, "run");
    });

    it("fails when the unpooled connection is the production database", () => {
      const decision = decideMigration({
        VERCEL_ENV: "preview",
        DATABASE_URL_UNPOOLED: url(PROD_HOST),
        DATABASE_URL: url(BRANCH_HOST, true),
        PRODUCTION_DATABASE_HOST: PROD_HOST,
      });
      assert.equal(decision.action, "fail");
      assert.match(decision.reason, /production database/);
    });

    it("fails when the pooled connection the app will use is the production database", () => {
      const decision = decideMigration({
        VERCEL_ENV: "preview",
        DATABASE_URL_UNPOOLED: url(BRANCH_HOST),
        DATABASE_URL: url(PROD_HOST, true),
        PRODUCTION_DATABASE_HOST: PROD_HOST,
      });
      assert.equal(decision.action, "fail");
    });

    it("recognises production whichever of its pooled or direct host names is configured", () => {
      const decision = decideMigration({
        VERCEL_ENV: "preview",
        DATABASE_URL_UNPOOLED: url(PROD_HOST),
        PRODUCTION_DATABASE_HOST: "EP-PROD-123-pooler.db.example.com",
      });
      assert.equal(decision.action, "fail");
    });

    it("fails when it cannot tell, because PRODUCTION_DATABASE_HOST is unset", () => {
      const decision = decideMigration({
        VERCEL_ENV: "preview",
        DATABASE_URL_UNPOOLED: url(BRANCH_HOST),
      });
      assert.equal(decision.action, "fail");
      assert.match(decision.reason, /PRODUCTION_DATABASE_HOST/);
    });
  });

  it("never puts any part of a connection string in its reason", () => {
    const envs = [
      { VERCEL_ENV: "production", DATABASE_URL_UNPOOLED: url(PROD_HOST) },
      {
        VERCEL_ENV: "preview",
        DATABASE_URL_UNPOOLED: url(PROD_HOST),
        PRODUCTION_DATABASE_HOST: PROD_HOST,
      },
      {
        VERCEL_ENV: "preview",
        DATABASE_URL_UNPOOLED: url(BRANCH_HOST),
        PRODUCTION_DATABASE_HOST: PROD_HOST,
      },
      { VERCEL_ENV: "preview", DATABASE_URL_UNPOOLED: url(BRANCH_HOST) },
      { VERCEL_ENV: "production", DATABASE_URL_UNPOOLED: `x${SECRET}` },
    ];
    for (const env of envs) {
      const { reason } = decideMigration(env);
      for (const fragment of [
        SECRET,
        "ep-prod-123",
        "ep-branch-456",
        "example.com",
      ]) {
        assert.ok(!reason.includes(fragment), `reason leaks ${fragment}`);
      }
    }
  });
});

describe("the CLI", () => {
  const run = (env) =>
    spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", ...env },
    });

  it("exits 0 without touching a database outside Vercel", () => {
    const result = run({ DATABASE_URL_UNPOOLED: url(PROD_HOST) });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /skip/i);
  });

  it("exits non-zero, before any migration, when a preview could reach production", () => {
    const result = run({
      VERCEL_ENV: "preview",
      DATABASE_URL_UNPOOLED: url(PROD_HOST),
      PRODUCTION_DATABASE_HOST: PROD_HOST,
    });
    assert.notEqual(result.status, 0);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(SECRET));
    assert.ok(!`${result.stdout}${result.stderr}`.includes("drizzle"));
  });
});
