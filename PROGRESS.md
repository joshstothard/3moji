# PROGRESS.md — #28: Delete apps/api and its CI jobs, image build, and doc references

**Issue:** https://github.com/joshstothard/3moji/issues/28
**Branch:** 28-delete-api
**Started:** 2026-09-12

## Plan

Delete the NestJS app and everything that referenced it, in one change, because the references are interdependent.

## Progress

- Deleted `apps/api` entirely, including its Dockerfile.
- CI: deleted the `image-api` job and the `openapi` job, removed `openapi` from the `needs` of both `build` and `security`, dropped `apps/api/dist/` from the build artifact, and removed the API start step, the health wait, and the two API env vars from the e2e job.
- Repointed the security agent at `apps/web/integration/security/` in `morlock.yml` and `ci-cd.md`.
- Stripped the `api` branch from `scripts/ci-smoke-test.sh`.
- Dropped `apps/api` from the probe list in `scripts/verify-agent-workflow.mjs`.
- Updated the `run` and `refine` skills, `README.md`, `AGENTS.md`, `docs/architecture/system-overview.md`, `docs/development/quality-strategy.md` and `docs/development/ci-cd.md`.
- `npm install` removed **208 packages**; zero `@nestjs/*` entries remain; `npm audit` reports 0 vulnerabilities.
- `scripts/verify.sh` passes.

## Decisions

- **The `openapi` job referenced a ruleset that never existed.** It lints `openapi.json` against `.spectral.yml`, and `.spectral.yml` is not in the repo. Both its steps swallow failure (`continue-on-error`, `|| true`), so it has always been a job that cannot fail. Deleting it removes a gate that gated nothing, which is worse than no gate because it looks like coverage.
- **The dangerous reference was not in CI.** `morlock.yml` tells the security agent to write proving tests under a path inside the deleted app. Nothing would have failed: the workflow would keep running, keep passing, and write findings into a directory that no longer exists. A security gate failing silently is the worst failure mode available, and it is why this issue needed reading rather than pattern-matching.
- **npm overrides left in place, deliberately.** Five of the six documented overrides existed solely for `@nestjs/*` transitives. Measured after deletion: `tmp` and `multer` have zero occurrences in the tree, `picomatch` still has ten and `lodash` one. So two are certainly dead and two may not be. Removing them safely needs the clean-install verification `engineering-standards.md` § Dependency Management prescribes, which is its own work. The `ci-cd.md` table now records what is dead, with the measurements, so the rationale is not silently false. Follow-up filed.
- **`glob` was already gone from the overrides block** but still had a row in the docs table. Removed while correcting it.
- **Postgres and Redis services kept on the e2e job.** They are unused now the API is gone, but #30 and #32 need Postgres, and removing them would be churn to re-add within the phase. Noted rather than silently kept.
- **`verify-agent-workflow.mjs` needed no fix to keep working** — its probe list falls through to `apps/web` by design. The stale entry was removed anyway, and `packages/core` added.

## Open Questions

None outstanding. Both from the refinement were resolved: the `agent-workflow-parity` check passes (it runs first in `verify.sh`), and no orphaned `packages/shared` exports were found, since `apps/api` was the only consumer of some OKR types but they are still exported and harmless — removing them is a separate cleanup, not required by any criterion here.
