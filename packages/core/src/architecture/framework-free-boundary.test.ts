import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * ADR-0006 decision 2 makes `packages/core` framework-free, and decision 8 makes
 * that boundary one of five conditions keeping a return to NestJS cheap. Two
 * ESLint rules in `packages/core/eslint.config.mjs` enforce it: a
 * `no-restricted-imports` half covering import statements, and a
 * `no-restricted-syntax` half covering the type-level `typeof import("next/…")`
 * form that the first half cannot see.
 *
 * The `no-restricted-syntax` selector matches a `TSImportType` node whose module
 * specifier sits at `source.value`. That is typescript-eslint's AST shape, not a
 * stable contract: if a future version renames the node or moves the literal, the
 * selector silently matches nothing, lint stays green because the other half still
 * works, and the type-import hole reopens with no signal (#39).
 *
 * This test lints fixtures through the real ESLint CLI, from `packages/core`, so
 * the config resolves exactly as `npm run lint` resolves it, and asserts on the
 * **rule name** in the reported message. Asserting merely that "lint failed" would
 * be satisfied by any unrelated error — which is how the original manual proof in
 * #29 was contaminated: lint was already failing because `tsconfig.json` did not
 * declare Jest types, so every `expect` tripped `no-unsafe-call`. The safe fixture
 * below is the defence: it must lint with zero messages, or this test reports a
 * contaminated baseline rather than a passing boundary.
 */

const coreDir = path.resolve(__dirname, "..", "..");
const repoRoot = path.resolve(coreDir, "..", "..");
const FIXTURE_DIR_PREFIX = "eslint-boundary-fixtures-";

/** Fixture sources are built as strings so this file itself holds no forbidden import. */
const fixtures = {
  "safe-type-import.fixture.ts": [
    "// A type-level import of a non-framework module must NOT be reported:",
    "// the rules must fire on the boundary, not on every import type node.",
    'export type NodeCrypto = typeof import("node:crypto");',
    "export const safeFixtureAnswer = 42;",
    "",
  ].join("\n"),
  "next-type-query.fixture.ts": [
    "// The hole `no-restricted-syntax` exists to close: a TSImportType node.",
    'export type NextHeaders = typeof import("next/headers");',
    "",
  ].join("\n"),
  "next-type-import.fixture.ts": [
    "// A type-only import declaration — still an import of a framework module.",
    'import type { cookies } from "next/headers";',
    "",
    "export type Cookies = typeof cookies;",
    "",
  ].join("\n"),
  "react-value-import.fixture.ts": [
    "// The plain-import half of the boundary.",
    'import { createElement } from "react";',
    "",
    "export type CreateElement = typeof createElement;",
    "",
  ].join("\n"),
} as const;

const fixtureTsconfig = JSON.stringify(
  {
    extends: "@template/tsconfig/base.json",
    compilerOptions: { types: ["node"] },
    include: ["*.ts"],
  },
  null,
  2,
);

const lintMessageSchema = z.object({
  ruleId: z.string().nullable(),
  message: z.string(),
  severity: z.number(),
});
const lintResultsSchema = z.array(
  z.object({
    filePath: z.string(),
    messages: z.array(lintMessageSchema),
  }),
);
type LintMessage = z.infer<typeof lintMessageSchema>;

function resolveEslintBin(): string {
  const candidates = [
    path.join(coreDir, "node_modules", "eslint", "bin", "eslint.js"),
    path.join(repoRoot, "node_modules", "eslint", "bin", "eslint.js"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Could not find the ESLint CLI. Looked in:\n  ${candidates.join("\n  ")}`,
  );
}

/** A fixture directory left behind by a crashed run would be linted by `npm run lint`. */
function removeStaleFixtureDirs(): void {
  for (const entry of fs.readdirSync(coreDir)) {
    if (entry.startsWith(FIXTURE_DIR_PREFIX)) {
      fs.rmSync(path.join(coreDir, entry), { recursive: true, force: true });
    }
  }
}

/** One line per message, so a failure prints what actually fired, verbatim. */
function summarise(messages: LintMessage[]): string[] {
  return messages.map((m) => `${m.ruleId ?? "(fatal)"}: ${m.message}`);
}

/**
 * Reports whether `rule` fired citing the ADR it enforces. Returns a sentence
 * rather than a boolean so a failing assertion prints every message ESLint
 * actually reported — the difference between "the boundary rule is gone" and
 * "something unrelated is failing" is the whole point of this test.
 */
function firingReport(rule: string, messages: LintMessage[]): string {
  const lines = summarise(messages);
  const fired = lines.filter(
    (line) => line.startsWith(`${rule}: `) && line.includes("ADR-0006"),
  );
  if (fired.length > 0) return `${rule} fired citing ADR-0006`;
  return (
    `${rule} did not fire citing ADR-0006; ESLint reported:\n` +
    (lines.join("\n") || "(no messages)")
  );
}

let fixtureDir = "";
let lintedByFixture = new Map<string, LintMessage[]>();

beforeAll(() => {
  removeStaleFixtureDirs();
  // Fixtures live outside `src` on purpose: `collectCoverageFrom` globs `src/**/*.ts`,
  // so a fixture created mid-run inside `src` could be counted as 0%-covered source
  // and drag the package under its coverage floor.
  fixtureDir = fs.mkdtempSync(path.join(coreDir, FIXTURE_DIR_PREFIX));
  fs.writeFileSync(path.join(fixtureDir, "tsconfig.json"), fixtureTsconfig);
  const fixturePaths: string[] = [];
  for (const [name, source] of Object.entries(fixtures)) {
    const file = path.join(fixtureDir, name);
    fs.writeFileSync(file, source);
    fixturePaths.push(file);
  }

  // Run the real CLI from `packages/core` with explicit file paths, which is how
  // `npm run lint` resolves `packages/core/eslint.config.mjs`. A guard that
  // resolved the config differently could pass while the real lint was broken.
  const run = spawnSync(
    process.execPath,
    [resolveEslintBin(), "--no-ignore", "--format", "json", ...fixturePaths],
    { cwd: coreDir, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  // 0 = clean, 1 = lint errors reported. Anything else (2 = config/parse crash) is
  // not evidence about the boundary rules and must not be read as one.
  if (run.status !== 0 && run.status !== 1) {
    throw new Error(
      `ESLint exited with status ${String(run.status)}, so its output says nothing ` +
        `about the boundary rules.\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
    );
  }
  const results = lintResultsSchema.parse(JSON.parse(run.stdout));
  lintedByFixture = new Map(
    results.map((result) => [path.basename(result.filePath), result.messages]),
  );
}, 180_000);

afterAll(() => {
  if (fixtureDir !== "") {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

function messagesFor(fixture: keyof typeof fixtures): LintMessage[] {
  const messages = lintedByFixture.get(fixture);
  // "Absence of evidence is never success": a missing result means the file was
  // never linted (ignored path, wrong cwd), and every "no errors were reported"
  // assertion below would pass vacuously.
  if (messages === undefined) {
    throw new Error(
      `ESLint reported no result for ${fixture}. Linted fixtures: ` +
        `${[...lintedByFixture.keys()].join(", ") || "(none)"}.`,
    );
  }
  return messages;
}

describe("packages/core framework-free boundary (ADR-0006 decision 2)", () => {
  it("lints a non-framework type import cleanly, so the baseline is trustworthy", () => {
    // A pre-existing lint error would otherwise masquerade as the boundary rule
    // firing — the exact way the manual proof in #29 was contaminated. This also
    // proves the rules are not over-matching every import type node.
    expect(summarise(messagesFor("safe-type-import.fixture.ts"))).toEqual([]);
  });

  it('reports a type-level `typeof import("next/headers")` via no-restricted-syntax', () => {
    expect(
      firingReport(
        "no-restricted-syntax",
        messagesFor("next-type-query.fixture.ts"),
      ),
    ).toBe("no-restricted-syntax fired citing ADR-0006");
  });

  it('reports a type-only `import type ... from "next/headers"` via no-restricted-imports', () => {
    expect(
      firingReport(
        "no-restricted-imports",
        messagesFor("next-type-import.fixture.ts"),
      ),
    ).toBe("no-restricted-imports fired citing ADR-0006");
  });

  it('reports a plain `import { createElement } from "react"` via no-restricted-imports', () => {
    expect(
      firingReport(
        "no-restricted-imports",
        messagesFor("react-value-import.fixture.ts"),
      ),
    ).toBe("no-restricted-imports fired citing ADR-0006");
  });
});
