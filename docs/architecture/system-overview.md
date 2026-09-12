# System overview

## Shape

A Turborepo monorepo on npm workspaces. Everything is TypeScript in strict mode.

`apps/web` is the only application that will be deployed ([ADR-0003](../adr/0003-nextjs-on-vercel-is-the-whole-application.md)). Route handlers and server actions are thin transport adapters over `packages/core`, which holds the domain logic and must import no framework.

| Path                                                | What it is                                                                                                                                                  | Port |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `apps/web`                                          | Next.js (App Router) frontend and backend. Still carries the template's OKR pages                                                                           | 3000 |
| `apps/api`                                          | NestJS backend with an in-memory OKR demo. **Planned for deletion, not yet removed** ([ADR-0003](../adr/0003-nextjs-on-vercel-is-the-whole-application.md)) | 3001 |
| `packages/core`                                     | **Planned, not yet built:** framework-free domain logic, use cases, and Zod schemas ([ADR-0003](../adr/0003-nextjs-on-vercel-is-the-whole-application.md))  | —    |
| `packages/shared`                                   | Types, Zod schemas, and constants shared across the workspace                                                                                               | —    |
| `packages/ui`                                       | Shared React component library (stub)                                                                                                                       | —    |
| `packages/test-utils`                               | Shared test helpers                                                                                                                                         | —    |
| `packages/tsconfig`, `eslint-config`, `jest-config` | Shared tooling presets                                                                                                                                      | —    |

## Communication

**Today:** the web app calls the NestJS API over HTTP, with the base URL from `NEXT_PUBLIC_API_URL`, defaulting to `http://localhost:3001` (`apps/web/src/lib/api.ts`). There is no database: API state lives in memory and resets on restart.

**Planned** ([ADR-0003](../adr/0003-nextjs-on-vercel-is-the-whole-application.md)): that cross-process call disappears. The web app talks to `packages/core` in-process, and `packages/core` talks to Neon Postgres through Drizzle using the serverless HTTP driver. Migrations run from committed files in the Vercel build step against the unpooled connection, with a database branch per preview deployment. No schema change is applied by hand.

## Deployment

**Planned** ([ADR-0003](../adr/0003-nextjs-on-vercel-is-the-whole-application.md)): Vercel on the Hobby plan, which forbids commercial use. Postgres is Neon via the Vercel Marketplace; transactional email is Resend, sending from a subdomain of `3moji.me`.

## Areas

- [data-model.md](data-model.md) — Account, Handle, Profile, Link, and the Emoji Set
- [auth.md](auth.md) — sign-in, verification, and the gate on claiming a Handle

## Quality gates

Local hooks (Husky pre-commit and pre-push), `scripts/verify.sh`, and GitHub Actions (`.github/workflows/ci.yml`) run the same checks: agent-workflow parity, script unit tests, lint, typecheck, unit tests, build, ADR sync, and `npm audit`. Scheduled workflows (nightly mutation testing and security scans) run on demand only.

Pull requests merge themselves once CI passes ([ADR-0003](../adr/0003-auto-merge-pull-requests-on-green-ci.md)). `.github/workflows/auto-merge.yml` runs `scripts/auto-merge.mjs`, which merges a PR labelled `automerge`, or a Dependabot PR containing only minor and patch updates, when the latest CI run on its up-to-date head commit succeeded. The repository has no GitHub branch protection (not available on its plan), so that workflow is the merge gate.

## How work is tracked

Work is tracked in GitHub Issues on a GitHub Project board and planned in `docs/reports/`, `docs/adr/`, and `docs/workstreams/` ([ADR-0002](../adr/0002-track-work-in-github-issues.md)). All tracker calls go through `scripts/gh-workflow.mjs`. See [docs/development/github-workflow.md](../development/github-workflow.md).
