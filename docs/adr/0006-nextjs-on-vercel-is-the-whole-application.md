# ADR-0006: Next.js on Vercel is the whole application

**Status:** Accepted, partially superseded by ADR-0010
**Date:** 2026-09-12

> Decision 6's clause "using the serverless HTTP driver" superseded by [ADR-0010: Use one Postgres driver in every environment](./0010-use-one-postgres-driver-in-every-environment.md) on 2026-09-12. The rest of this ADR still applies.

## Context

This repository was adapted from a Turborepo template that ships two applications: `apps/web` (Next.js 16, App Router) and `apps/api` (NestJS 11). The NestJS app holds an in-memory OKR demo with no database, no persistence, and no authentication. It is template scaffolding, not a foundation.

3moji needs persistence, email-and-password authentication with verification and password reset, and a public page per Handle. It is built by one developer working with a coding agent, on free tiers, and the owner has stated three constraints: host everything on Vercel, use free services for the MVP, and own the backend rather than rent it.

Two research reports inform this decision: [the auth library report](../reports/2026-09-11-auth-library.md) and [the hosting and email report](../reports/2026-09-11-hosting-and-email.md).

## Options considered

| Option                           | Pros                                                                                            | Cons                                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **A: Next.js only** (chosen)     | One deployment; auth tables in our own database; least code for an MVP; keeps a later API cheap | Route handlers have no dependency-injection container, so the documented DI rule needs amending                                             |
| B: Supabase as a backend service | Least application code to write                                                                 | Relocates logic into vendor row-level-security policies that the Jest suite cannot see and that cannot be taken elsewhere; fails "own it"   |
| C: Keep NestJS                   | Matches the template as shipped                                                                 | A second deployment off Vercel; the existing app has no database and no auth, so it is not a head start; carries quality gates on dead code |

## Decision

1. **`apps/web` is the only deployed application.** Route handlers and server actions are thin transport adapters: they parse input, call a use case, and format the response.
2. **Domain logic and validation schemas live in a framework-free `packages/core`.** No `next/*` imports, no React, no Vercel-proprietary primitives. A NestJS controller must be able to call the same use case unchanged.
3. **`apps/api` is deleted**, along with its workspace and Turborepo entries. Git retains the history.
4. **Dependencies are constructor-injected through a manual composition root**, not a DI container. This **amends** `docs/development/engineering-standards.md` § Layer Boundaries, which requires DI to wire them at runtime.
5. **Better Auth owns authentication**, pinned with its Drizzle adapter, with the user, session, password-hash and verification tables in our own Postgres. It is configured with `requireEmailVerification`, `autoSignInAfterVerification`, and `revokeSessionsOnPasswordReset`. `autoSignInAfterVerification` is not a default and is load-bearing: without it, verifying an email drops the user at a sign-in page instead of the Profile they just claimed. A hand-rolled sessions module is the named fallback.
6. **Neon Postgres via the Vercel Marketplace**, using the serverless HTTP driver. `drizzle-kit migrate` runs from committed migration files in the build step against the unpooled connection, with a database branch per preview deployment. No schema change is ever applied by hand.
7. **Resend sends transactional email**, from a subdomain of `3moji.me` rather than the apex, so a deliverability problem cannot poison the root domain.
8. **Five conditions keep a return to NestJS cheap**, and a change that breaks any of them needs a new ADR: decisions 2 and 3 hold; migrations stay owned in-repo; auth tables stay ours; and no Vercel-only primitive appears in `packages/core`.

## Consequences

- Vercel Hobby forbids commercial use. Any premium tier, or Handle trading, requires moving to Pro first.
- The 70% coverage floor and mutation testing now bite on `packages/core`, which is where the logic worth testing lives. That is the point.
- Integration tests need a real Postgres, and end-to-end tests need an authenticated fixture. `docs/development/quality-strategy.md` changes accordingly.
- Deleting `apps/api` removes the `okr` demo and the `health` module. Nothing depends on them.
- Decision 4 is a documented deviation from an existing standard, not an oversight. A reviewer seeing constructor injection without a container should find this ADR.

## Related

- Report: [Auth library for owned email-and-password sign-in](../reports/2026-09-11-auth-library.md)
- Report: [Free-tier Postgres and transactional email](../reports/2026-09-11-hosting-and-email.md)
- Workstream: [3moji MVP](../workstreams/3moji-mvp.md)
- Issues: #17, #8
- Architecture: [system-overview.md](../architecture/system-overview.md), [auth.md](../architecture/auth.md)
