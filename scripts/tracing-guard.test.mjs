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
// So this checks exactly those two preconditions, plus the ways a Next.js app
// turns tracing on: a tracing package declared or imported, and a `register()`
// in an instrumentation file, which is where Next.js starts a tracer.
//
// **An instrumentation file is allowed, for `onRequestError` only** (#203,
// decided by the repo owner). `apps/web/src/instrumentation.ts` reports a
// render error nothing caught through `logFailure`, which is a log line, not a
// span. So the file may exist, but every instrumentation file may export
// nothing except `onRequestError` — no `register`, no default, no `export *` —
// and may import no tracing module. Until #203 the guard forbade the file
// outright; narrowing it gave up nothing the reason above needs.
//
// It has no production behaviour of its own: it reads the installed tree and
// the source. When one of these fails, the fix is not to relax the check — it
// is to make the decision recorded as *proposed* in AGENTS.md and then replace
// this guard with one that asserts the chosen redaction.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DECISION =
  "Tracing would record bound query values. Settle the proposed decision in AGENTS.md § Observability (#148) before enabling it.";

/** The one export an instrumentation file may have (#203). */
const ALLOWED_INSTRUMENTATION_EXPORT = "onRequestError";

/** Source trees whose imports are scanned, and what inside them is skipped. */
const SCANNED_TREES = ["apps/web", "packages/core"];
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "coverage",
  "test-results",
  "playwright-report",
]);
const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

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

/** Every source file under `dir`, skipping build output and dependencies. */
function sourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...sourceFiles(path.join(dir, entry.name)));
      }
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

/**
 * Whether a file name is one Next.js loads as instrumentation: `instrumentation`
 * itself, its `.node` and `.edge` variants, and `instrumentation-client`.
 */
export function isInstrumentationFile(fileName) {
  return /^instrumentation(?:\.node|\.edge|-client)?\.(?:[cm]?[jt]sx?)$/.test(
    fileName,
  );
}

/** Instrumentation files where Next.js looks for them: the app and its `src`. */
function instrumentationFiles() {
  const files = [];
  for (const base of ["apps/web", "apps/web/src"]) {
    for (const entry of readdirSync(path.join(root, base), {
      withFileTypes: true,
    })) {
      if (entry.isFile() && isInstrumentationFile(entry.name)) {
        files.push(path.join(root, base, entry.name));
      }
    }
  }
  return files;
}

/**
 * Whether a module source loads `@opentelemetry/api` or assigns drizzle's
 * `otel` handle. Exported for the self-test below, which proves it can fail.
 * It is for drizzle-orm's `tracing.js` only: the `otel =` clause would
 * misfire on ordinary code, so the source scan uses {@link tracingImports}.
 */
export function loadsOpenTelemetry(source) {
  return (
    /(?:import\s*\(|require\s*\(|from\s+)\s*["']@opentelemetry\/api["']/.test(
      source,
    ) || /\botel\s*=(?!=)/.test(source)
  );
}

/**
 * Whether a module specifier names a tracing package. `@opentelemetry/*` and
 * `@vercel/otel` are the ones #148 is about; the others are APM agents that
 * instrument `pg` and would put the same statements on spans of their own.
 */
export function isTracingModule(specifier) {
  const name = specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
  return (
    name.startsWith("@opentelemetry/") ||
    name.startsWith("@sentry/") ||
    name.startsWith("@honeycombio/") ||
    [
      "@vercel/otel",
      "@prisma/instrumentation",
      "dd-trace",
      "newrelic",
      "elastic-apm-node",
    ].includes(name)
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
  return names.filter(isTracingModule);
}

/**
 * The tracing modules a source file imports: static imports, re-exports,
 * `import()` and `require()`, read by TypeScript's own import scanner, so a
 * package name in a comment or a string is not an import.
 */
export function tracingImports(source) {
  return ts
    .preProcessFile(source, true, true)
    .importedFiles.map((file) => file.fileName)
    .filter(isTracingModule);
}

function hasModifier(node, kind) {
  return (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

/**
 * Every name a module exports, read from its syntax tree. `export *` is `*`
 * and a default export is `default`, since neither can be checked by name.
 */
export function exportedNames(source, fileName = "module.ts") {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    false,
  );
  const names = [];
  for (const statement of file.statements) {
    if (ts.isExportAssignment(statement)) {
      names.push("default");
    } else if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      if (clause === undefined) names.push("*");
      else if (ts.isNamespaceExport(clause)) names.push(clause.name.text);
      else for (const element of clause.elements) names.push(element.name.text);
    } else if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
        names.push("default");
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            names.push(declaration.name.text);
          } else {
            names.push("<destructured>");
          }
        }
      } else if ("name" in statement && statement.name !== undefined) {
        names.push(statement.name.text);
      }
    }
  }
  return names;
}

/** What an instrumentation file does that the guard forbids, as messages. */
export function instrumentationViolations(source, fileName) {
  const violations = [];
  for (const name of exportedNames(source, fileName)) {
    if (name !== ALLOWED_INSTRUMENTATION_EXPORT) {
      violations.push(
        name === "register"
          ? "exports register(), which is where Next.js starts a tracer"
          : `exports ${name}, and only ${ALLOWED_INSTRUMENTATION_EXPORT} is allowed`,
      );
    }
  }
  for (const specifier of tracingImports(source)) {
    violations.push(`imports ${specifier}`);
  }
  return violations;
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

  it("an instrumentation file exports only onRequestError and imports no tracing module", () => {
    for (const file of instrumentationFiles()) {
      assert.deepEqual(
        instrumentationViolations(readFileSync(file, "utf8"), file),
        [],
        `${path.relative(root, file)} may export only ${ALLOWED_INSTRUMENTATION_EXPORT} and import no tracing module (#203). ${DECISION}`,
      );
    }
  });

  it("no source file in apps/web or packages/core imports a tracing module", () => {
    for (const tree of SCANNED_TREES) {
      for (const file of sourceFiles(path.join(root, tree))) {
        assert.deepEqual(
          tracingImports(readFileSync(file, "utf8")),
          [],
          `${path.relative(root, file)} imports a tracing module. ${DECISION}`,
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

  it("the import check can fail, and ignores a name that is not an import", () => {
    for (const source of [
      'import { trace } from "@opentelemetry/api";',
      'import "@opentelemetry/sdk-node";',
      'export { registerOTel } from "@vercel/otel";',
      'const otel = await import("@opentelemetry/api");',
      'const tracer = require("dd-trace");',
      'import * as Sentry from "@sentry/nextjs";',
    ]) {
      assert.equal(tracingImports(source).length, 1, source);
    }
    assert.deepEqual(
      tracingImports(
        '// no "@opentelemetry/api" import here\nconst name = "@vercel/otel";\nimport { x } from "./otel";',
      ),
      [],
    );
  });

  it("the instrumentation check refuses register in every spelling", () => {
    for (const source of [
      "export function register() {}",
      "export async function register() {}",
      "export const register = () => {};",
      "function register() {}\nexport { register };",
      "function setUp() {}\nexport { setUp as register };",
      'export { register } from "./tracing";',
    ]) {
      assert.ok(
        instrumentationViolations(source, "instrumentation.ts").some((v) =>
          v.startsWith("exports register()"),
        ),
        source,
      );
    }
    for (const source of [
      'export * from "./tracing";',
      "export default function () {}",
      "export const onRequestError = () => {};\nexport const other = 1;",
    ]) {
      assert.notDeepEqual(
        instrumentationViolations(source, "instrumentation.ts"),
        [],
        source,
      );
    }
    assert.deepEqual(
      instrumentationViolations(
        'import type { Instrumentation } from "next";\nimport { reportRequestError } from "./lib/request-error";\nexport const onRequestError: Instrumentation.onRequestError = (e, r) => reportRequestError(e, r);',
        "instrumentation.ts",
      ),
      [],
    );
    assert.equal(isInstrumentationFile("instrumentation.ts"), true);
    assert.equal(isInstrumentationFile("instrumentation.node.ts"), true);
    assert.equal(isInstrumentationFile("instrumentation.edge.mjs"), true);
    assert.equal(isInstrumentationFile("instrumentation-client.ts"), true);
    assert.equal(isInstrumentationFile("instrumentation.test.ts"), false);
  });
});
