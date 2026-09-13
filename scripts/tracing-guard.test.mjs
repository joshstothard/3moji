// Fails the build if OpenTelemetry tracing could start recording bound query
// values before the decision in AGENTS.md § Observability is made. Run with
// `npm run test:scripts`.
//
// Two libraries in the tree would put a statement's parameters on a span
// (#148), and neither does today:
//
// - drizzle-orm 0.45.2 sets `drizzle.query.params` — `JSON.stringify(params)`,
//   so every email address, token hash and Profile field — on a span for every
//   statement (`node-postgres/session.js`). It is dormant only because the
//   `import("@opentelemetry/api")` in its `tracing.ts` is commented out, so its
//   module-local `otel` is never assigned. A drizzle-orm upgrade that restores
//   that import turns it on with no change in this repository.
// - better-auth 1.7.4 instruments itself by default and loads
//   `@opentelemetry/api` with a dynamic import. Its adapter factory opens a
//   span per statement and calls `span.recordException(error)` with the raw
//   drizzle error, whose message carries the parameters. It is dormant only
//   because `@opentelemetry/api` is not installed.
//
// So this checks exactly those two preconditions, plus the two ways a Next.js
// app turns tracing on. It has no production behaviour of its own: it reads the
// installed tree. When one of these fails, the fix is not to relax the check —
// it is to make the decision recorded as *proposed* in AGENTS.md and then
// replace this guard with one that asserts the chosen redaction.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DECISION =
  "Tracing would record bound query values. Settle the proposed decision in AGENTS.md § Observability (#148) before enabling it.";

/** Workspace directories: the root, and every apps/* and packages/* entry. */
function workspaces() {
  const dirs = [root];
  for (const parent of ["apps", "packages"]) {
    for (const entry of readdirSync(path.join(root, parent), {
      withFileTypes: true,
    })) {
      const dir = path.join(root, parent, entry.name);
      if (entry.isDirectory() && existsSync(path.join(dir, "package.json"))) {
        dirs.push(dir);
      }
    }
  }
  return dirs;
}

/**
 * Whether a module source loads `@opentelemetry/api` or assigns drizzle's
 * `otel` handle. Exported for the self-test below, which proves it can fail.
 */
export function loadsOpenTelemetry(source) {
  return (
    /(?:import\s*\(|require\s*\(|from\s+)\s*["']@opentelemetry\/api["']/.test(
      source,
    ) || /\botel\s*=(?!=)/.test(source)
  );
}

/** Tracing packages a workspace declares, from its `package.json`. */
export function declaredTracingPackages(manifest) {
  const names = Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  });
  return names.filter(
    (name) => name.startsWith("@opentelemetry/") || name === "@vercel/otel",
  );
}

describe("tracing cannot record bound query values (#148)", () => {
  it("drizzle-orm's tracer never loads @opentelemetry/api", () => {
    const tracing = readFileSync(
      path.join(root, "node_modules", "drizzle-orm", "tracing.js"),
      "utf8",
    );
    assert.equal(
      loadsOpenTelemetry(tracing),
      false,
      `drizzle-orm/tracing.js now loads @opentelemetry/api, so drizzle.query.params reaches spans. ${DECISION}`,
    );
  });

  it("@opentelemetry/api cannot be resolved from any workspace", () => {
    for (const dir of workspaces()) {
      const require = createRequire(path.join(dir, "package.json"));
      assert.throws(
        () => require.resolve("@opentelemetry/api"),
        { code: "MODULE_NOT_FOUND" },
        `@opentelemetry/api resolves from ${path.relative(root, dir) || "."}, so better-auth's instrumentation records raw exceptions. ${DECISION}`,
      );
    }
  });

  it("no workspace declares a tracing package", () => {
    for (const dir of workspaces()) {
      const manifest = JSON.parse(
        readFileSync(path.join(dir, "package.json"), "utf8"),
      );
      assert.deepEqual(
        declaredTracingPackages(manifest),
        [],
        `${path.relative(root, dir) || "."}/package.json declares a tracing package. ${DECISION}`,
      );
    }
  });

  it("the web app has no Next.js instrumentation hook", () => {
    for (const base of ["apps/web", "apps/web/src"]) {
      for (const ext of ["ts", "js", "mjs"]) {
        const file = path.join(root, base, `instrumentation.${ext}`);
        assert.equal(
          existsSync(file),
          false,
          `${path.relative(root, file)} exists, which is where Next.js registers tracing. ${DECISION}`,
        );
      }
    }
  });

  it("the source check can fail, so a pass means something", () => {
    assert.equal(
      loadsOpenTelemetry('otel = await import("@opentelemetry/api");'),
      true,
    );
    assert.equal(loadsOpenTelemetry("let otel;\nif (!otel) {}"), false);
    assert.deepEqual(
      declaredTracingPackages({
        dependencies: { "@vercel/otel": "1", next: "16" },
        devDependencies: { "@opentelemetry/sdk-trace-node": "2" },
      }),
      ["@vercel/otel", "@opentelemetry/sdk-trace-node"],
    );
  });
});
