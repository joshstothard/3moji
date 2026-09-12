# System overview

## Shape

A Turborepo monorepo on npm workspaces. Everything is TypeScript in strict mode.

| Path                                                | What it is                                                                                                                           | Port |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| `apps/web`                                          | Next.js (App Router) frontend: home, dashboard, and OKR objective pages                                                              | 3000 |
| `apps/api`                                          | NestJS backend: `health` module and an `okr` module (objectives, key results, check-ins) backed by an in-memory store with seed data | 3001 |
| `packages/shared`                                   | Types, Zod schemas, and constants shared by web and api                                                                              | —    |
| `packages/ui`                                       | Shared React component library (stub)                                                                                                | —    |
| `packages/test-utils`                               | Shared test helpers                                                                                                                  | —    |
| `packages/tsconfig`, `eslint-config`, `jest-config` | Shared tooling presets                                                                                                               | —    |

## Communication

The web app calls the API over HTTP. The base URL comes from `NEXT_PUBLIC_API_URL`, defaulting to `http://localhost:3001` (`apps/web/src/lib/api.ts`). There is no database: API state lives in memory and resets on restart.

## Quality gates

Local hooks (Husky pre-commit and pre-push), `scripts/verify.sh`, and GitHub Actions (`.github/workflows/ci.yml`) run the same checks: agent-workflow parity, script unit tests, lint, typecheck, unit tests, build, ADR sync, and `npm audit`. Scheduled workflows (nightly mutation testing and security scans) run on demand only.

Pull requests merge themselves once CI passes ([ADR-0003](../adr/0003-auto-merge-pull-requests-on-green-ci.md)). `.github/workflows/auto-merge.yml` runs `scripts/auto-merge.mjs`, which merges a PR labelled `automerge`, or a Dependabot PR containing only minor and patch updates, when the latest CI run on its up-to-date head commit succeeded. The repository has no GitHub branch protection (not available on its plan), so that workflow is the merge gate.

## How work is tracked

Work is tracked in GitHub Issues on a GitHub Project board and planned in `docs/reports/`, `docs/adr/`, and `docs/workstreams/` ([ADR-0002](../adr/0002-track-work-in-github-issues.md)). All tracker calls go through `scripts/gh-workflow.mjs`. See [docs/development/github-workflow.md](../development/github-workflow.md).
