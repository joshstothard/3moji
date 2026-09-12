# ADR-0008: Handles are addressable by emoji and by their word alias

**Status:** Accepted
**Date:** 2026-09-12

## Context

A Handle is addressable at `3moji.me/🧊🧊🧊` and that route is built ([ADR-0004](./0004-the-handle-model.md) decision 1). Putting that URL where people share links does not work.

**Autolinkers commonly truncate a path at the first non-ASCII byte.** The predicted failure is not that `3moji.me/🧊🧊🧊` fails to become a link, but that it becomes a link to `3moji.me/` with the emoji left beside it as plain text — the Handle silently discarded and the visitor landed on the home page, which is worse than no link because it looks like it worked.

**The strength of the evidence here is worth stating plainly, because this premise carries the decision.** Truncation of non-ASCII URLs by autolinkers and mis-parsing of an emoji adjacent to a link are _reported_ behaviours, not something measured against Instagram or LinkedIn in this repository — doing so needs real accounts and is left as an outstanding check. What _is_ measured is everything below. The decision does not rest on the reported behaviour alone: even if a platform linkified the emoji path perfectly, the only ASCII spelling of it is 45 characters of `%F0%9F…`, so a shareable word form would still be wanted.

**Nothing we control changes this.** Measured against the pinned Next.js version: navigating to `/🧊🧊🧊` and to `/%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A` yields a byte-identical `location.pathname`, so the address bar receives the same input either way. `history.replaceState(null, "", "/🧊🧊🧊")` is a no-op and `new URL()` re-encodes, because the WHATWG URL specification's path percent-encode set requires it. There is no header, meta tag or API for address-bar formatting. The server is not the cause: a raw-UTF-8 path, the canonical encoded path and lower-case hex all answer 200 with no `Location`.

**The precedent is the product this one is modelled on.** what3words' brand form `///pretty.needed.chill` does not work as a web link at all, by their own documentation; their shareable link is ASCII, `w3w.co/pretty.needed.chill`. A pretty form that is not a URL, and an ASCII one for sharing — **separated by dots**, which turns out to matter.

The words already ship. `emoji-curation.ts` holds 307 rows for the released categories; `displayName`, `spokenName`, `plural` and `synonyms` yield **937 distinct term slugs**, 3.1 per emoji. Measured in this session:

| Property                                           | Value                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Terms resolving to exactly one emoji               | 907 of 937 (96.8%)                                                                     |
| Three-term queries resolving to exactly one Handle | **90.7%** — ambiguity compounds across the three positions                             |
| Worst single term                                  | `celebration` → 4 emoji → 64 candidate Handles                                         |
| `apple`                                            | 🍎 and 🍏, so `apple.apple.apple` names **8** Handles, one of them the reserved 🍎🍎🍎 |
| Longest canonical alias                            | 74 characters, against a 150-character Instagram bio                                   |

**Two kinds of ambiguity must be separated, and conflating them is what makes a naive grammar fail.** _Resolution_ ambiguity — one word naming two emoji — is inherent and is handled by showing the reader a choice. _Parse_ ambiguity — not knowing where one word ends and the next begins — is a defect, and a hyphen-joined grammar has it badly. Over a targeted sweep of 44,976 hyphen-joined candidates, **1,152 admitted more than one valid three-emoji reading**: `curry-rice-wine-pizza` parses as `curry` + `rice-wine` + `pizza` _and_ as `curry-rice` + `wine` + `pizza`, which are different Handles. ADR-0004 decision 2's exactly-three rule does not save it, because both readings have three parts.

Slugging collapses every non-alphanumeric character to `-`, so **no term contains a dot**, and none collides with a file-extension tail. A dot-separated grammar therefore has no parse ambiguity by construction. Dotted segments reach the route cleanly: `/apple.apple.apple` returns our 404, not a 400 or a static-file interception — **verified under `next dev` only.** Whether Vercel's CDN treats a dotted path segment as a static-file request is unverified, and the implementing issue must check it in a deployed environment before relying on the grammar.

Today every ASCII spelling — `/apple.apple.apple`, `/ice-cube.ice-cube.ice-cube` — returns 404 through the existing `/[handle]` route, so this is not a new namespace but a second grammar in the one the emoji route already owns.

## Options considered

| Option                                                        | Pros                                                                                                                                                   | Cons                                                                                                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Emoji URL only (status quo)                                   | Nothing to build; one identity                                                                                                                         | The share case is broken in the worst way — the link works and goes to the wrong page                                                                        |
| Percent-encoded form as the shared link                       | Pure ASCII, linkifies everywhere, zero new code                                                                                                        | 45 characters of `%F0%9F…`; destroys the thing the product is for                                                                                            |
| Hyphen-joined word alias                                      | Reads as one phrase                                                                                                                                    | **Measured broken**: 1,152 of 44,976 candidates have two valid readings                                                                                      |
| **Emoji canonical, plus a dot-separated word alias (chosen)** | Emoji stays the brand and the identity; ASCII and linkifies everywhere; parse-unambiguous by construction; the words already ship; echoes the w3w form | A second grammar on the root route; a listing state; alias stability now depends on curation                                                                 |
| Words as the primary address, replacing emoji                 | One grammar                                                                                                                                            | Gives up the emoji URL, which already works and is the brand; and our word forms are ambiguous where w3w's are not, with no location context to disambiguate |

## Decision

1. **A Handle has one identity and two addresses.** The canonical key stays exactly as ADR-0004 decision 1 defines it: the three-code-point sequence. The word alias is a **derived lookup, never a stored second identity** — no column, no migration, no second uniqueness constraint.

2. **The alias grammar is three dot-separated term slugs.** A slug is a curated name lowercased with every run of non-alphanumerics collapsed to `-`. The separator is a dot because dots cannot occur inside a slug, which makes the parse unambiguous by construction; a hyphen separator is measurably not.

3. **Every position accepts any of that emoji's terms, so one Handle has many aliases and exactly one canonical alias.** The canonical alias joins the three `displayName` slugs — 🧊🧊🧊 is `ice-cube.ice-cube.ice-cube` — and is what the product publishes, copies to the clipboard and prints. Synonyms, plurals and CLDR names are accepted on input, which is what makes the shorter `apple.apple.apple` work.

4. **An alias resolves to a candidate set, and the count decides the response.**

   | Claimed Handles matching | Response                                                                                                      |
   | ------------------------ | ------------------------------------------------------------------------------------------------------------- |
   | exactly one              | **Render that Profile in place** — not a redirect, because the shared ASCII link must stay in the address bar |
   | more than one            | A listing of the matching Handles, each showing its emoji and the owner's display name                        |
   | none                     | The claim call to action, as an unclaimed emoji Handle already does                                           |

   Unclaimed and Reserved Handles are omitted from a listing: an entry exists because a Profile exists.

5. **The emoji URL is canonical for machines.** An alias page declares `rel="canonical"` pointing at the emoji path. An alias is ambiguous by construction and so can never be canonical; this keeps one indexable URL per Profile.

6. **The owner's display name disambiguates a listing, and no unique username is introduced.** The Profile already carries a 30-character display name. A second unique namespace would recreate the scarcity and land-grab the emoji Handle exists to replace, and give every Account two identities to keep in sync.

7. **Both grammars live on the one root route.** `/[handle]` dispatches on the received segment: emoji spellings go to `canonicalise` unchanged, ASCII spellings go to the alias resolver. The emoji path's four rejection reasons and its 308 behaviour are untouched.

## Consequences

- **This partially supersedes ADR-0004 decision 1.** Its clause "one that cannot be canonicalised returns 404" is no longer true: an ASCII segment that resolves as an alias is answered, not 404'd. The rest of decision 1 — the canonical key, NFC, stripping the selectors, the `UNIQUE` index, canonicalise-before-every-write, and the 308 for an oddly spelled emoji path — stands unchanged.
- **The share case becomes possible at all**, which is the point. The flex and the link stop being the same string: a bio carries 🧊🧊🧊 as text, which every platform renders correctly, beside an ASCII link every platform linkifies.
- **A listing page is new product surface** that nothing else in the plan needed — an index of Profiles, with the privacy and ranking questions that implies. Phase 4 or 5, not Phase 3.
- **Alias stability is now coupled to curation, and this is the sharpest negative.** `displayName` is curated and mutable by design — 29 of 307 are overridden and the aubergine rename already happened here. Renaming one silently changes every alias containing it, breaking links already in people's bios. Deriving from the immutable CLDR `spokenName` would avoid it but yields `/ice.ice.ice`, the exact defect the curated layer exists to fix ([ADR-0005](./0005-the-emoji-set.md) decision 3). The chosen trade keeps quality and accepts that **a curated display-name change is a breaking URL change**, requiring the old alias to be retained as a redirect. Curation is no longer cosmetic.
- **A later category drop can turn a working direct link into a listing.** Releasing a category adds terms, and a term unambiguous today may name two emoji tomorrow, so an alias that loaded one Profile can begin showing a listing of two. ADR-0007 decision 6 never withdraws a category, so aliases are append-only, but their _resolution_ is not stable across drops.
- **Roughly one alias in ten needs a disambiguating tap** (9.3% of three-term queries), worst case 64 candidates. Acceptable only because a listing exists; a word box that jumped straight to a Profile would send people to the wrong one.
- **On-platform search falls out of the same index.** The 937-term map that resolves an alias is the map that powers looking up a Handle you heard, which is the product's founding use case.
- **The canonical alias is repetitive and long** — `red-apple.red-apple.red-apple` is 29 characters and reads worse aloud than "three red apples". The spoken form (`spokenHandle`) is deliberately _not_ the grammar: it is a different string with articles and collapsed runs, and parsing it would be a second, harder problem.
- Current-state impact: `docs/architecture/system-overview.md` § Routing and `docs/architecture/data-model.md` § Handle and § Profile are updated alongside this ADR, marked planned rather than built.

## Related

- Workstream: [3moji MVP](../workstreams/3moji-mvp.md)
- Report: [How emoji survive in URL paths](../reports/2026-09-11-emoji-urls.md)
- Supersedes: [ADR-0004: The Handle model](./0004-the-handle-model.md) — decision 1 in part only
- Architecture: [system-overview.md](../architecture/system-overview.md), [data-model.md](../architecture/data-model.md)
