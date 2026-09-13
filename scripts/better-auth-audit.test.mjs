// Fails the build when a precondition of the `HTTP_DISABLED_AUTH_PATHS` audit
// changes (#169). Run with `npm run test:scripts`.
//
// `packages/core/src/auth/create-auth.ts` refuses Better Auth's Account-creating
// endpoints over HTTP (#150). That list is complete only because of a measured
// fact about the installed library: which code creates a `user` row, and which
// endpoints reach it. A routine upgrade — including a Dependabot minor or patch
// bump, which auto-merges — or a plugin added to the application can add an
// endpoint that creates an Account with no Handle, breaking ADR-0004 decision 4
// silently. So this reads the installed tree and the application source, and
// compares them with the facts in `scripts/better-auth-audit.mjs`.
//
// It has no production behaviour. When it fails, the fix is the recheck in
// docs/architecture/auth.md § Rechecking the Account-creation audit, not an
// edit to the audited facts to make it pass.
//
// What it cannot catch:
// - A user row written without a `create…User…` identifier *and* without a
//   literal `"user"` model argument — for example a model name built at
//   runtime, or a minified build that renames properties.
// - A caller in a package outside `better-auth` and `@better-auth/*` that
//   reaches the internal adapter, or a re-export under an unrelated name.
// - A plugin whose list is assembled elsewhere and passed in under an unchanged
//   expression (the check compares `plugins:` text, not its runtime value), or
//   a provider or plugin configured from the environment rather than source.
// - A Better Auth instance configured outside a workspace's `src/` directory:
//   only `apps/*/src` and `packages/*/src` are read, because workspace-root
//   tooling config has `plugins` options that are not Better Auth's.
// - Reachability. It says something changed; the recheck decides what.

import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { AUDIT, RECHECK } from "./better-auth-audit.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const RUNTIME_JS = /\.(?:mjs|cjs|js)$/;
const SOURCE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST_SOURCE = /(?:\.test\.|\.spec\.|\.d\.ts$)/;
const SKIPPED_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  "e2e",
  "__tests__",
  ".turbo",
]);

const toPosix = (p) => p.split(path.sep).join("/");

function walk(dir, include, skip = () => false) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skip(entry.name)) files.push(...walk(full, include, skip));
    } else if (entry.isFile() && include(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Every installed copy of `better-auth` and `@better-auth/*` under a
 * `node_modules` directory, including nested copies. Symlinks (workspace
 * links) are not followed.
 */
export function installedBetterAuthPackages(nodeModules) {
  const found = [];
  if (!existsSync(nodeModules)) return found;
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(nodeModules, entry.name);
    if (entry.name.startsWith("@")) {
      for (const scoped of readdirSync(full, { withFileTypes: true })) {
        if (!scoped.isDirectory()) continue;
        const pkg = path.join(full, scoped.name);
        if (entry.name === "@better-auth") found.push(pkg);
        found.push(
          ...installedBetterAuthPackages(path.join(pkg, "node_modules")),
        );
      }
    } else if (!entry.name.startsWith(".")) {
      if (entry.name === "better-auth") found.push(full);
      found.push(
        ...installedBetterAuthPackages(path.join(full, "node_modules")),
      );
    }
  }
  return found;
}

function readManifest(dir) {
  return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
}

/** Installed copies under the repository root and every workspace. */
function installedCopies(root) {
  const nodeModulesDirs = [path.join(root, "node_modules")];
  for (const parent of ["apps", "packages"]) {
    const dir = path.join(root, parent);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory())
        nodeModulesDirs.push(path.join(dir, entry.name, "node_modules"));
    }
  }
  return nodeModulesDirs.flatMap(installedBetterAuthPackages).map((dir) => ({
    dir,
    manifest: readManifest(dir),
  }));
}

/**
 * `create…User…` identifiers in a source text, counted. Matches property
 * access, destructuring, string keys and definitions alike, so an aliased call
 * (`const { createUser: make } = internalAdapter`) still counts. Does not match
 * `createdUser`.
 */
export function userCreationTokens(source) {
  const counts = {};
  for (const [token] of source.matchAll(
    /(?<![\w$])create(?:[A-Z][\w$]*)?User[\w$]*/g,
  )) {
    counts[token] = (counts[token] ?? 0) + 1;
  }
  return counts;
}

/** The text of a call's argument list, from the `(` at `open` to its match. */
function callArguments(source, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return source.slice(open + 1);
}

/** Direct writes of the `user` model in a source text. */
export function userModelWrites(source) {
  let count = 0;
  for (const match of source.matchAll(/createWithHooks\s*\(/g)) {
    const args = callArguments(source, match.index + match[0].length - 1);
    if (/,\s*["']user["']\s*(?:,|$)/.test(args.trim())) count += 1;
  }
  count += [
    ...source.matchAll(/\.create\w*\s*\(\s*\{\s*model\s*:\s*["']user["']/g),
  ].length;
  return count;
}

/** `better-auth` / `@better-auth/*` module specifiers a source imports. */
export function betterAuthSpecifiers(source) {
  const specifiers = new Set();
  const pattern =
    /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']((?:better-auth|@better-auth\/)[^"']*)["']/g;
  for (const [, specifier] of source.matchAll(pattern))
    specifiers.add(specifier);
  return [...specifiers].sort();
}

/** Every `plugins` option in a source text, whitespace removed. */
export function pluginOptions(source) {
  const values = [];
  for (const match of source.matchAll(/(?<![\w$.?])plugins\s*:(?!:)/g)) {
    let i = match.index + match[0].length;
    let depth = 0;
    let quote = null;
    const start = i;
    for (; i < source.length; i += 1) {
      const ch = source[i];
      if (quote) {
        if (ch === "\\") i += 1;
        else if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if ("([{".includes(ch)) depth += 1;
      else if (")]}".includes(ch)) {
        if (depth === 0) break;
        depth -= 1;
      } else if ((ch === "," || ch === ";") && depth === 0) break;
    }
    values.push(source.slice(start, i).replace(/\s+/g, ""));
  }
  for (const _ of source.matchAll(/[{,]\s*plugins\s*(?=[,}])/g))
    values.push("plugins (shorthand)");
  return values;
}

/** The `HTTP_DISABLED_AUTH_PATHS` literal in create-auth.ts, or null. */
export function disabledPathsLiteral(source) {
  const match = /HTTP_DISABLED_AUTH_PATHS[^=]*=\s*\[([^\]]*)\]/.exec(source);
  if (!match) return null;
  return [...match[1].matchAll(/["']([^"']*)["']/g)].map(([, p]) => p);
}

function sorted(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function describeDifference(actual, audited) {
  const lines = [];
  for (const file of new Set([
    ...Object.keys(actual),
    ...Object.keys(audited),
  ])) {
    const a = JSON.stringify(
      actual[file] === undefined ? null : sortedValue(actual[file]),
    );
    const b = JSON.stringify(
      audited[file] === undefined ? null : sortedValue(audited[file]),
    );
    if (a !== b) lines.push(`  ${file}: installed ${a}, audited ${b}`);
  }
  return lines.sort().join("\n");
}

function sortedValue(value) {
  if (Array.isArray(value)) return [...value].sort();
  if (value !== null && typeof value === "object") return sorted(value);
  return value;
}

/** Version problems: every installed copy must be the audited version. */
export function versionProblems(copies, audit = AUDIT) {
  const problems = [];
  for (const [name, version] of Object.entries(audit.versions)) {
    const matching = copies.filter((copy) => copy.manifest.name === name);
    if (matching.length === 0) {
      problems.push(
        `${name} is not installed, but the audit was made against ${version}. ${RECHECK}`,
      );
    }
    for (const copy of matching) {
      if (copy.manifest.version !== version) {
        problems.push(
          `${name} ${copy.manifest.version} is installed (${copy.label ?? copy.dir}), but the HTTP_DISABLED_AUTH_PATHS audit was made against ${version}. ${RECHECK}`,
        );
      }
    }
  }
  return problems;
}

/** Scan a package directory's runtime JavaScript. */
export function scanPackage(dir) {
  const tokens = {};
  const writes = {};
  const files = walk(
    dir,
    (name) => RUNTIME_JS.test(name),
    (name) => name === "node_modules" || name === "src",
  );
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const rel = toPosix(path.relative(dir, file));
    const found = userCreationTokens(source);
    if (Object.keys(found).length > 0) tokens[rel] = found;
    const count = userModelWrites(source);
    if (count > 0) writes[rel] = count;
  }
  return { tokens, writes };
}

/** Caller problems: the scans of every copy must equal the audited tables. */
export function callerProblems(scans, audit = AUDIT) {
  const problems = [];
  for (const { name, label, tokens, writes } of scans) {
    const auditedTokens = audit.userCreationTokens[name] ?? {};
    const tokenDiff = describeDifference(tokens, auditedTokens);
    if (tokenDiff !== "") {
      problems.push(
        `The create…User… call sites in ${label} differ from the audited set, so an endpoint may now create an Account the HTTP_DISABLED_AUTH_PATHS list does not refuse:\n${tokenDiff}\n${RECHECK}`,
      );
    }
    const writeDiff = describeDifference(
      writes,
      audit.userModelWrites[name] ?? {},
    );
    if (writeDiff !== "") {
      problems.push(
        `The direct writes of the user model in ${label} differ from the audited set, so something other than the audited methods may now create an Account:\n${writeDiff}\n${RECHECK}`,
      );
    }
  }
  return problems;
}

/**
 * Non-test application source in every workspace's `src/`, as `file → text`.
 * Only `src/`: workspace-root tooling config (PostCSS, ESLint) has `plugins`
 * options of its own that are not Better Auth's.
 */
export function applicationSource(root) {
  const files = {};
  for (const parent of ["apps", "packages"]) {
    const dir = path.join(root, parent);
    if (!existsSync(dir)) continue;
    for (const workspace of readdirSync(dir, { withFileTypes: true })) {
      if (!workspace.isDirectory()) continue;
      for (const file of walk(
        path.join(dir, workspace.name, "src"),
        (name) => SOURCE.test(name) && !TEST_SOURCE.test(name),
        (name) => SKIPPED_DIRS.has(name) || name.startsWith("."),
      )) {
        files[toPosix(path.relative(root, file))] = readFileSync(file, "utf8");
      }
    }
  }
  return files;
}

/** Plugin problems: imports and `plugins` options must equal the audit. */
export function pluginProblems(sources, audit = AUDIT) {
  const problems = [];
  const imports = {};
  const plugins = {};
  for (const [file, source] of Object.entries(sources)) {
    const specifiers = betterAuthSpecifiers(source);
    if (specifiers.length > 0) imports[file] = specifiers;
    const options = pluginOptions(source);
    if (options.length > 0) plugins[file] = options;
  }
  const importDiff = describeDifference(imports, audit.sourceImports);
  if (importDiff !== "") {
    problems.push(
      `The Better Auth modules the application imports differ from the audited set, which is how a plugin arrives:\n${importDiff}\n${RECHECK}`,
    );
  }
  const pluginDiff = describeDifference(plugins, audit.pluginOptions);
  if (pluginDiff !== "") {
    problems.push(
      `The Better Auth plugins passed to createAuth differ from the audited set. A plugin can add its own Account-creating endpoints:\n${pluginDiff}\n${RECHECK}`,
    );
  }
  const createAuth = sources["packages/core/src/auth/create-auth.ts"];
  const literal =
    createAuth === undefined ? null : disabledPathsLiteral(createAuth);
  if (JSON.stringify(literal) !== JSON.stringify(audit.httpDisabledPaths)) {
    problems.push(
      `HTTP_DISABLED_AUTH_PATHS in packages/core/src/auth/create-auth.ts is ${JSON.stringify(literal)}, but the audit records ${JSON.stringify(audit.httpDisabledPaths)}. ${RECHECK}`,
    );
  }
  return problems;
}

/** Every problem for a repository root, as messages. Empty means the audit holds. */
export function auditProblems(root, audit = AUDIT) {
  const copies = installedCopies(root).map((copy) => ({
    ...copy,
    label: `${toPosix(path.relative(root, copy.dir))}@${copy.manifest.version}`,
  }));
  const scans = copies.map((copy) => ({
    name: copy.manifest.name,
    label: copy.label,
    ...scanPackage(copy.dir),
  }));
  return [
    ...versionProblems(copies, audit),
    ...callerProblems(scans, audit),
    ...pluginProblems(applicationSource(root), audit),
  ];
}

describe("Better Auth cannot reopen Account creation over HTTP unaudited (#169)", () => {
  const copies = installedCopies(repoRoot).map((copy) => ({
    ...copy,
    label: `${toPosix(path.relative(repoRoot, copy.dir))}@${copy.manifest.version}`,
  }));

  it("the installed Better Auth versions are the audited ones", () => {
    assert.deepEqual(versionProblems(copies), []);
  });

  it("the code that creates a user row is the audited set", () => {
    const scans = copies.map((copy) => ({
      name: copy.manifest.name,
      label: copy.label,
      ...scanPackage(copy.dir),
    }));
    assert.deepEqual(callerProblems(scans), []);
  });

  it("no Better Auth plugin or disabled path has changed without the audit", () => {
    assert.deepEqual(pluginProblems(applicationSource(repoRoot)), []);
  });

  it("each detector can fail, so a pass means something", () => {
    // Tokens: a direct call, an aliased destructure and a string key all count;
    // an unrelated `createdUser` variable does not.
    assert.deepEqual(
      userCreationTokens(
        'await ctx.context.internalAdapter.createUser({});\nconst { createUser: make } = adapter;\nconst createdUser = 1;\nx["createUser"];',
      ),
      { createUser: 3 },
    );
    assert.deepEqual(
      userCreationTokens("const createdUser = await make();"),
      {},
    );

    // User-model writes, including a multi-line call and a raw adapter create.
    assert.equal(
      userModelWrites(
        'createWithHooks({\n  a: f(1, "x"),\n}, "user", void 0);',
      ),
      1,
    );
    assert.equal(
      userModelWrites('createWithHooks(data, "account", void 0);'),
      0,
    );
    assert.equal(
      userModelWrites('await adapter.create({ model: "user", data });'),
      1,
    );

    // Imports and plugin options.
    assert.deepEqual(
      betterAuthSpecifiers(
        'import { magicLink } from "better-auth/plugins";\nconst p = await import("@better-auth/passkey");',
      ),
      ["@better-auth/passkey", "better-auth/plugins"],
    );
    assert.deepEqual(
      pluginOptions(
        "betterAuth({ plugins: [nextCookies(), magicLink({ send })], x: 1 })",
      ),
      ["[nextCookies(),magicLink({send})]"],
    );
    assert.deepEqual(pluginOptions("readonly plugins?: NonNullable<X>;"), []);
    assert.deepEqual(
      disabledPathsLiteral(
        'const HTTP_DISABLED_AUTH_PATHS: readonly string[] = [\n  "/a",\n  "/b",\n];',
      ),
      ["/a", "/b"],
    );

    // End to end, against a fixture tree that matches a small audit and then
    // drifts from it in each of the three ways.
    const fixture = mkdtempSync(path.join(tmpdir(), "better-auth-audit-169-"));
    try {
      const put = (rel, text) => {
        mkdirSync(path.dirname(path.join(fixture, rel)), { recursive: true });
        writeFileSync(path.join(fixture, rel), text);
      };
      const audit = {
        versions: { "better-auth": "1.0.0" },
        httpDisabledPaths: ["/sign-up/email"],
        userCreationTokens: {
          "better-auth": { "dist/sign-up.mjs": { createUser: 1 } },
        },
        userModelWrites: { "better-auth": {} },
        sourceImports: {
          "packages/core/src/auth/create-auth.ts": ["better-auth"],
        },
        pluginOptions: {
          "packages/core/src/auth/create-auth.ts": ["input.plugins"],
        },
      };
      put(
        "node_modules/better-auth/package.json",
        '{"name":"better-auth","version":"1.0.0"}',
      );
      put(
        "node_modules/better-auth/dist/sign-up.mjs",
        "ctx.context.internalAdapter.createUser({});",
      );
      put(
        "packages/core/src/auth/create-auth.ts",
        'import { betterAuth } from "better-auth";\nconst HTTP_DISABLED_AUTH_PATHS = ["/sign-up/email"];\nbetterAuth({ plugins: input.plugins });',
      );
      assert.deepEqual(auditProblems(fixture, audit), []);

      put(
        "node_modules/better-auth/package.json",
        '{"name":"better-auth","version":"1.1.0"}',
      );
      put(
        "node_modules/better-auth/dist/plugins/new.mjs",
        "const { createUser: make } = ctx.context.internalAdapter;",
      );
      put(
        "apps/web/src/lib/services.ts",
        'import { magicLink } from "better-auth/plugins";\nx({ plugins: [magicLink()] });',
      );
      const problems = auditProblems(fixture, audit);
      assert.equal(problems.length, 4, problems.join("\n\n"));
      assert.match(problems[0], /better-auth 1\.1\.0 is installed/);
      assert.match(
        problems[1],
        /dist\/plugins\/new\.mjs: installed \{"createUser":1\}, audited null/,
      );
      assert.match(
        problems[2],
        /apps\/web\/src\/lib\/services\.ts: installed \["better-auth\/plugins"\], audited null/,
      );
      assert.match(
        problems[3],
        /apps\/web\/src\/lib\/services\.ts: installed \["\[magicLink\(\)\]"\], audited null/,
      );
      for (const problem of problems)
        assert.match(
          problem,
          /docs\/architecture\/auth\.md § Rechecking the Account-creation audit/,
        );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
