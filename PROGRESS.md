# PROGRESS.md — #248: Implement ADR-0011: one-Handle canonical aliases and the claim listing

**Issue:** https://github.com/joshstothard/3moji/issues/248
**Branch:** 248-canonical-alias-claim-listing
**Started:** 2026-09-14

## Plan

1. Core: optional curated `aliasName` on `EmojiCuration` and `CuratedEmoji`; set for 🦇 bats, 🐋 whales, 🦗 grasshopper, 🌼 flower, 🍨 sundae.
2. Core: `canonicalAliasOf` uses the `displayName` slug when unique, else `aliasName`.
3. Core: curation test over the released set for the four ADR-0011 decision 3 conditions.
4. Web: `/[handle]` claim listing for several candidates, none claimed; only `available` rows; empty state with the Find a Handle lookup.
5. E2E: `apple.apple.apple` (8 candidates, 🍎🍎🍎 Reserved) renders the claim listing; axe and keyboard.
6. Docs: system-overview, data-model, workstream tick and changelog.

## Progress

_Nothing logged yet._

## Decisions

_None yet._

## Open Questions

- What an `unknown` availability answer does in the claim listing (read failure).
