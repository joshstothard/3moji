# PROGRESS — #49 Ship the released Emoji Set into packages/core

## Plan

- Generator `scripts/generate-emoji-set.mjs` reads `docs/reports/2026-09-11-emoji-set.candidates.json`
  (1,053 entries) and emits `packages/core/src/emoji/emoji-candidates.generated.ts`.
- Hand-edited `packages/core/src/emoji/emoji-category.ts` holds `RELEASED_CATEGORIES` — the
  one-line change for the next drop (ADR-0007 decision 5).
- `packages/core/src/emoji/emoji-set.ts` derives the released set through a single filter,
  marks every entry `released`, and exposes a lookup by code point.
- Tests in `emoji-set.test.ts` cover the seven acceptance criteria plus a drift guard that
  reparses the candidate JSON, proving the data is derived rather than retyped.

## Decisions

- Generated `.ts`, not `.json`: `tsc` does not copy `.json` into `outDir`, so a JSON import
  would build clean and fail at runtime against `main: ./dist/index.js`.
- `released` is derived from `RELEASED_CATEGORIES`, not baked into the generated file, so a
  drop needs no regeneration.
- Lookup keys on the single-character code point only (what the Handle canonicaliser produces
  per `docs/architecture/data-model.md`), never on the `U+XXXX` notation.

## Log

- Claimed #49, branched `49-released-emoji-set` from `origin/main`, `npm install`.
- Observed red (domain): stub with an empty candidate list → `Expected length: 307 / Received length: 0`,
  `Expected: 1053 / Received: 0`, lookup `Received: undefined`. 11 failed, 9 passed.
- Observed red (generator): idempotence test failed against the stub output. 1 failed, 9 passed.
- Mutation evidence for tests that pass vacuously on empty data:
  - adding `"Objects"` to `RELEASED_CATEGORIES` → 5 failed (307 → 490, plus both unreleased-category tests).
  - injecting a ZWJ entry into the generated data → 6 failed, including the single-code-point test.
  - commenting out the `releasedEmojiSet` re-export → the index entry-point test failed.
- Green: 91/91 in `@template/core` (100% lines), 41/41 script tests, `scripts/verify.sh` all checks passed.
- Restructured the unreleased-category tests to spell the five categories out rather than derive them
  from `RELEASED_CATEGORIES` — `it.each` over a derived list silently vanishes instead of failing.
- `[...emoji].length` tripped `@typescript-eslint/no-misused-spread`; replaced with a `codePointAt`
  helper rather than a disable comment.
