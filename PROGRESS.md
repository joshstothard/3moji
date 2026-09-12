# PROGRESS.md — #29: Create packages/core with an enforced framework-free boundary

**Issue:** https://github.com/joshstothard/3moji/issues/29
**Branch:** 29-packages-core
**Started:** 2026-09-12

## Plan

Create `packages/core` as the framework-free domain package, enforce the boundary with a lint rule that is _observed firing_, and make the engineering-standards amendment that ADR-0006 asserts but nobody had written.

## Progress

- Scaffolded `packages/core`: package manifest, tsconfig (plus a build variant excluding tests), ESLint config, Jest config, README.
- Wrote the boundary rule and proved which import forms it blocks.
- Added a `Clock` port, a system-clock adapter, and the composition root as the worked example the standards amendment needs.
- Tests written first and observed red, then green. 7 tests, coverage 100%.
- Amended `docs/development/engineering-standards.md`: the SOLID Dependency Inversion row and the Layer Boundaries rules, plus a new composition-root section with the worked example.
- Merged `origin/main` (which gained #37) before the first push, reconciling the lockfile.
- `scripts/verify.sh` passes; `@template/core` now participates in build, lint, typecheck and test.

## Decisions

- **The lint evidence was contaminated on the first attempt, and this is the most important note here.** I added a forbidden import, saw lint fail, and nearly recorded that as proof the rule fired. It was not: lint was _already_ failing before the probe, because `packages/core/tsconfig.json` did not declare Jest types, so every `expect` in the test files tripped `no-unsafe-call` under type-aware linting. Fixed by adding `"types": ["node", "jest"]`, the same way `apps/api` does it. Only then was the baseline genuinely clean and the probe's failure attributable to the boundary rule.
- **`no-restricted-imports` has a hole, and it is now closed.** It inspects import _statements_, so a type-level `typeof import("next/headers")` passed straight through. Confirmed by probing the AST (the node is `TSImportType` with a `source` literal) and closed with a `no-restricted-syntax` rule targeting it. Verified: the type query is now blocked, and `node:crypto` and `zod` type imports still pass.
- **Five import forms verified blocked, individually:** `next/headers`, bare `next`, `@vercel/functions`, `react`, and `react-dom/client`.
- **A `Clock` port is the worked example rather than something invented.** The acceptance criteria require a worked example for the standards amendment, and ADR-0004's 24-hour hold and 30-day cooldown are untestable if the domain reads the system clock directly. This is the port those rules will use.
- **An entry-point test was needed for coverage.** Re-exports in `src/index.ts` never execute unless imported, leaving coverage at 55.55%. The test asserts the public API is exported and was proved red by removing an export.
- **`packages/shared` has no `lint` script and no ESLint config, so it is never linted.** Not fixed here: out of scope and it would widen this diff. Worth an issue.

## Open Questions

Both from the refinement, resolved during implementation:

1. `packages/core` needs no build step for consumers (it exports source in development, like `packages/shared`), but a `build` script exists so Turborepo's graph and the production `dist` output work.
2. The `core` versus `shared` boundary is now stated in `packages/core/README.md`.
