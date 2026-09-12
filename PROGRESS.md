# PROGRESS.md — #27: Remove the OKR demo pages and API client from the web app

**Issue:** https://github.com/joshstothard/3moji/issues/27
**Branch:** 27-remove-okr-demo
**Started:** 2026-09-12

## Plan

Remove everything OKR from `apps/web`, leaving an app with no dead links and no references to a backend that is about to be deleted (#28).

1. Delete the routes: `app/objectives/` (including `[id]` and the nested check-in route) and `app/dashboard/`, with their tests.
2. Delete `lib/okr-api.ts` and `lib/api.ts`, with their tests.
3. Fix `components/footer.tsx`, which imports `fetchApiVersion` from `lib/api` — see Decisions.
4. Strip the `/objectives` and `/dashboard` links from `components/navbar.tsx` and rebrand it from "OKR Tracker".
5. Replace the home page body (currently two cards linking to the deleted routes) with a minimal placeholder.
6. Remove `NEXT_PUBLIC_API_URL` from `apps/web/.env.example`.
7. Update `navbar.test.tsx`, `footer.test.tsx`, `page.test.tsx`.

## Progress

- Deleted `app/objectives/` (with `[id]` and the nested check-in route), `app/dashboard/`, `lib/api.ts`, `lib/okr-api.ts` and all four test files.
- Rewrote `footer.tsx` as a sync component showing the UI version only; removed the now-unused `Footer.api` key from `en.json`.
- Rebranded `navbar.tsx` to "3moji" and removed both section links.
- Replaced the home page body with a placeholder.
- Updated `layout.tsx` metadata: title and description no longer say OKR.
- Removed `NEXT_PUBLIC_API_URL` from `apps/web/.env.example`.
- Rewrote `page.test.tsx`, `navbar.test.tsx`, `footer.test.tsx`; added `layout.test.tsx`.
- Updated `docs/architecture/system-overview.md` for the new current state.
- **Coverage 55.55% -> 100%**; 13 tests across 4 suites. `scripts/verify.sh` passes.

## Decisions

- **The footer keeps its version line but drops the API half.** `footer.tsx` calls `fetchApiVersion()` from the client being deleted. Deleting the footer outright loses a useful build-version display; keeping the call is impossible. So it renders the UI version only, and the now-unused `Footer.api` key is removed from `packages/shared/messages/en.json`.
- **`packages/shared` OKR types stay for now.** `types/okr.ts`, `schemas/okr.ts` and `constants/cycles.ts` are still imported by `apps/api`, which #28 deletes. Removing them here would break that app before its own issue runs.
- **Branch created from `origin/main` rather than `git switch main`**, because `main` is checked out in another worktree and git refuses a second checkout. Same base commit.
- **Added a CSS mapper to the shared Next.js Jest preset.** Deleting the well-tested OKR pages dropped web coverage to 55.55%, below the 70% floor, leaving `layout.tsx` as the only uncovered file. Testing it was impossible: `packages/jest-config/nextjs.js` had no stylesheet mapping, so `import "./globals.css"` crashed the suite before any assertion ran. No Next.js layout in this repo could ever have been tested. Added `packages/jest-config/style-mock.js` and mapped stylesheets to it, preserving the base preset's existing mappers. This is a shared-config change forced by a quality gate, not scope creep.
- **`next/font/google` is mocked in `layout.test.tsx`.** Its font loader is build-time only and cannot run under Jest. Mocked locally rather than in the shared preset, since only this file needs it.
- **`NEXT_PUBLIC_API_URL` remains in `.github/workflows/ci.yml`.** It sits in the end-to-end job's env block beside the API start command, which is explicitly #28's scope. Left there deliberately.

## Open Questions

Both resolved during implementation:

1. The placeholder home page shows the product name and one line, no links. Throwaway; the real one is the Phase 3 builder.
2. The navbar survives as the brand shell with its links removed.
