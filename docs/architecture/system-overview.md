# System overview

## Shape

A Turborepo monorepo on npm workspaces. Everything is TypeScript in strict mode.

`apps/web` is the only application that will be deployed ([ADR-0006](../adr/0006-nextjs-on-vercel-is-the-whole-application.md)). Route handlers and server actions are thin transport adapters over `packages/core`, which holds the domain logic and must import no framework.

| Path                                                | What it is                                                                                                                                                 | Port |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `apps/web`                                          | Next.js (App Router) frontend and backend. A placeholder home page; the real one arrives with the Handle builder                                           | 3000 |
| `packages/core`                                     | **Planned, not yet built:** framework-free domain logic, use cases, and Zod schemas ([ADR-0006](../adr/0006-nextjs-on-vercel-is-the-whole-application.md)) | —    |
| `packages/shared`                                   | Types, Zod schemas, and constants shared across the workspace                                                                                              | —    |
| `packages/ui`                                       | Shared React component library (stub)                                                                                                                      | —    |
| `packages/test-utils`                               | Shared test helpers                                                                                                                                        | —    |
| `packages/tsconfig`, `eslint-config`, `jest-config` | Shared tooling presets                                                                                                                                     | —    |

## Communication

**Today:** there is one application. `apps/api` has been deleted ([ADR-0006](../adr/0006-nextjs-on-vercel-is-the-whole-application.md)), so nothing runs on port 3001 and no cross-process call remains. There is no database yet.

**Planned** ([ADR-0006](../adr/0006-nextjs-on-vercel-is-the-whole-application.md)): that cross-process call disappears. The web app talks to `packages/core` in-process, and `packages/core` talks to Neon Postgres through Drizzle using the serverless HTTP driver. Migrations run from committed files in the Vercel build step against the unpooled connection, with a database branch per preview deployment. No schema change is applied by hand.

## Routing

**Partly built.** Three routes exist: the Handle builder at `/`, Better Auth's whole HTTP surface at `/api/auth/[...all]`, and the Handle route at `/[handle]` — the product's canonical URL, `3moji.me/🧊🧊🧊`.

### The home page

`apps/web/src/app/page.tsx` is a server component that holds no state and fetches nothing. Its whole job is composition: it hands `HandleBuilder` the availability read and lets the builder own the interaction.

The builder is a client component, and it reaches the domain through **`@template/core/browser`** — a second entry point that exists because the root barrel re-exports `db/client` and so cannot be bundled for a browser (`next build` fails with `Can't resolve 'dns'`, `'fs'`, `'net'`, `'tls'` and `'util/types'`). That subpath is a deliberate allowlist of pure functions and frozen Emoji Set data; `packages/core/src/browser.test.ts` walks its transitive imports and fails if anything under `db/`, `auth/`, `ports/` or `adapters/` appears. Adding a name to it is a decision, not a convenience.

The tagline and the URL preview come from the domain rather than from the UI: `spokenHandle` collapses runs in order, and `canonicalise` produces the percent-encoded segment the availability read is asked about — the same one `/[handle]` would receive.

**Availability is read lazily, through a server action, and never on the render path.** `lib/services.ts` throws unless all five of `DATABASE_URL`, `RESEND_API_KEY`, `RESEND_FROM`, `BETTER_AUTH_URL` and `BETTER_AUTH_SECRET` are set, so a page that resolved services while rendering would 500 on a fresh clone and in CI's E2E job. Instead `/` prerenders as static content, and `checkAvailability` runs only once a visitor has filled three slots. Every failure on that path — a missing variable, a refused connection — answers `"unknown"`, which the builder renders as a line of copy rather than letting it reach the page as a rejection. Until an environment has those five variables, every complete Handle reads "We could not check this Handle just now."

Every control in the builder is permanent: one button per slot for the life of the page, relabelled when it fills and when it clears. That is an accessibility requirement rather than a styling choice — swapping the control unmounts the focused node and drops focus to `<body>` — and `aria-disabled` is used throughout in place of `disabled`, which would take a button out of the tab order under a keyboard user's feet.

### The Handle route

`apps/web/src/app/[handle]/page.tsx` is a thin transport adapter: it hands the received path segment to `canonicalise` in `packages/core` and formats the answer. It holds no canonicalisation logic and reads no database.

| `canonicalise` says           | The route answers                                              |
| ----------------------------- | -------------------------------------------------------------- |
| not a Handle, for any reason  | `notFound()` — 404. Junk is never redirected                   |
| a Handle, spelled oddly       | `permanentRedirect("/" + encoded)` — 308 to the canonical path |
| a Handle, spelled canonically | A minimal "this Handle is available" placeholder               |

Two constraints from [the emoji URL report](../reports/2026-09-11-emoji-urls.md) bind any future work on this route, and both were re-confirmed against the pinned Next.js version:

- **`params` arrives percent-encoded.** `/🧊🧊🧊` and `/%F0%9F%A7%8A…` reach the page as the same 36-character encoded string. Next.js also upper-cases the escapes, so a lower-case-hex request is already canonical; the spelling that genuinely differs is a stray variation selector.
- **A redirect target is always the encoded form.** A raw emoji in a `Location` header fails Node's header validation with `ERR_INVALID_CHAR` and serves a 500.

A malformed escape such as `/%F0%9F` never reaches the page: Next.js rejects it first, with 400 in dev and 500 in production.

**The dynamic segment is one segment, not a catch-all**, so it cannot claim `/api/auth/...` or any other multi-segment path. An end-to-end test asserts that, because `[...handle]` would compile, match those paths and 404 them.

The `/[handle]` placeholder is deliberately the whole of the unclaimed state for now — see the Profile section of [data-model.md](data-model.md). The builder on `/` shows availability but offers no Claim: claiming is Phase 3's own issue, with its own transaction.

### The word alias

**Planned, not yet built** ([ADR-0008](../adr/0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md)). The emoji URL cannot be shared: an autolinker truncates a path at the first non-ASCII byte, so `3moji.me/🧊🧊🧊` in a bio becomes a link to `3moji.me/` with the emoji orphaned beside it as text. Nothing server-side changes that — both spellings reach the browser as the same percent-encoded `location.pathname`.

So a Handle gets a second address: **three dot-separated term slugs**, `3moji.me/ice-cube.ice-cube.ice-cube`. The identity is unchanged — the alias is a derived lookup over the curated names, with no column and no migration.

**The separator is a dot because a hyphen is measurably ambiguous.** Slugging collapses non-alphanumerics to `-`, so a hyphen-joined form cannot say where one word ends: `curry-rice-wine-pizza` reads as `curry` + `rice-wine` + `pizza` _and_ as `curry-rice` + `wine` + `pizza`, both three emoji, so ADR-0004's exactly-three rule does not disambiguate. A dot cannot occur inside a slug, so the parse is unambiguous by construction.

Every position accepts any of that emoji's terms, so one Handle has many aliases and exactly one **canonical** alias (the `displayName` slugs). The resolver answers on the count of _claimed_ matches:

| Claimed Handles matching | The route answers                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| exactly one              | that Profile, rendered in place — **not** a redirect, so the shared ASCII link stays in the address bar |
| more than one            | a listing of the matches, each with its emoji and the owner's display name                              |
| none                     | the claim call to action                                                                                |

The alias page will declare `rel="canonical"` pointing at the emoji path: an alias is ambiguous by construction and so can never be canonical.

Both grammars share the one root route, dispatching on the received segment. Dotted segments already reach it cleanly — `/apple.apple.apple` answers the route's own 404 rather than being taken for a static file.

## Deployment

**Planned** ([ADR-0006](../adr/0006-nextjs-on-vercel-is-the-whole-application.md)): Vercel on the Hobby plan, which forbids commercial use. Postgres is Neon via the Vercel Marketplace; transactional email is Resend, sending from a subdomain of `3moji.me`.

## Areas

- [data-model.md](data-model.md) — Account, Handle, Profile, Link, and the Emoji Set
- [auth.md](auth.md) — sign-in, verification, and the gate on claiming a Handle

## Quality gates

Local hooks (Husky pre-commit and pre-push), `scripts/verify.sh`, and GitHub Actions (`.github/workflows/ci.yml`) run the same checks: agent-workflow parity, script unit tests, lint, typecheck, unit tests, build, ADR sync, and `npm audit`. Scheduled workflows (nightly mutation testing and security scans) run on demand only.

Pull requests merge themselves once CI passes ([ADR-0003](../adr/0003-auto-merge-pull-requests-on-green-ci.md)). `.github/workflows/auto-merge.yml` runs `scripts/auto-merge.mjs`, which merges a PR labelled `automerge`, or a Dependabot PR containing only minor and patch updates, when the latest CI run on its up-to-date head commit succeeded. The repository has no GitHub branch protection (not available on its plan), so that workflow is the merge gate.

## How work is tracked

Work is tracked in GitHub Issues on a GitHub Project board and planned in `docs/reports/`, `docs/adr/`, and `docs/workstreams/` ([ADR-0002](../adr/0002-track-work-in-github-issues.md)). All tracker calls go through `scripts/gh-workflow.mjs`. See [docs/development/github-workflow.md](../development/github-workflow.md).
