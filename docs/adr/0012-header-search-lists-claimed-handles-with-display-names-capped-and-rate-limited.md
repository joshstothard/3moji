# ADR-0012: Header search lists claimed Handles with display names, capped and rate-limited

**Status:** Accepted
**Date:** 2026-09-14

## Context

On 2026-09-14 the repo owner asked for "Find a Handle" to become a search bar in the site header. Clicking or typing in it should show claimed Handles, their emoji and the name of the person who registered each one.

The only lookup today is `/find` ([#200](https://github.com/joshstothard/3moji/issues/200)). It is a no-JavaScript `GET` page, not an API. It takes the words of one address, redirects to that alias path, and "reveals nothing the alias path would not" (`docs/architecture/system-overview.md` § Finding a Handle).

The site is deliberately built so that accounts cannot be listed in bulk:

- a response floor on the claim and auth paths
- per-client rate limits on `claim_rate_limit`, with fixed windows and keys hashed with HMAC
- Better Auth's own limiter, with keys hashed the same way
- a sitemap that lists no Profile, because "a sitemap of claimed Handles would publish every one of them"

[ADR-0008](./0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md) calls a listing of Profiles "new product surface … with the privacy and ranking questions that implies" and leaves ranking open. Its consequences also note that the 937-term index which resolves an alias "is the map that powers looking up a Handle you heard".

A claimed Handle's emoji and its owner's display name are already public, one Profile page at a time. A search makes them findable in bulk. That difference is what this ADR has to meter.

When shown three scopes, the owner chose claimed Handles with names only, rate-limited, capped and not ranked by popularity. They then accepted this draft with display names shown but not searchable.

## Options considered

| Option                                                                   | Pros                                                                                                          | Cons                                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Claimed Handles with display names, capped and rate-limited (chosen)** | Does what the owner asked; shows only what a Profile already shows; the display name tells 🍎🍎🍎 from 🍏🍏🍏 | Claimed Handles become a metered directory                           |
| Emoji and availability only, no names                                    | The most private                                                                                              | Cannot tell two matching Handles apart; not what the owner asked for |
| Claimed, held and available Handles with names, unlimited                | Simplest to build                                                                                             | Anyone can scrape the whole user list                                |
| Display names searchable as well                                         | Finds a person by name                                                                                        | Makes looking someone up by name a feature; the owner declined it    |

## Decision

1. **The site header carries a search that anyone can use without signing in.** It is a client island that queries a new `GET /api/search?q=` route, in the pattern of the account menu and `/api/viewer`. The root layout and navbar still read no session or request headers. `/find` stays as the no-JavaScript fallback.
2. **Handle results are claimed Handles only.** Held, unclaimed and Reserved Handles never appear. Each result carries:
   - the emoji
   - the canonical word alias ([ADR-0011](./0011-canonical-word-aliases-name-one-handle-and-unclaimed-aliases-list-claimable-handles.md))
   - the owner's display name, when one is set
3. **Matching uses the curated term index and emoji, never free text.**
   - A query is one to three words or emoji.
   - Handles are returned only when every word is a complete known term slug or an emoji, and every one of them occurs in the Handle, in any position.
   - Emoji suggestions may prefix-match curated names from two characters, because the curated names are public product data.
   - **Display names are shown but are not searchable.**
4. **A response holds at most 5 Handles and 8 emoji.**
5. **Results are ordered without popularity or recency:**
   1. a Handle that matches the whole query exactly
   2. then Handles that contain more of the query's emoji
   3. then the resolver's candidate order
6. **Search is rate limited at 60 requests per client address per fixed 10-minute window.**
   - The counter lives on `claim_rate_limit` under a new `search-client:` bucket kind, with the same keyed hash and client-address grouping as the other buckets.
   - The island debounces typing by 250 ms.
   - A request over the limit gets a plain `429` with no retry hint.
   - The limit is a starting value to tune, like the Claim's.
7. **Responses are `Cache-Control: private, no-store`,** so no shared cache can answer around the limit.
   - There is no response floor: search reveals only public Profile data and never whether an Account or an email address exists.
   - The route logs through `atBoundary` as `search.read`, and never logs the query text.
8. **The privacy notice says that claimed Handles and display names can be found through the site's search.** The MVP has no per-Profile opt-out.

## Consequences

- **Finding a Handle you heard of becomes a typeahead in the header**, the founding use case ADR-0008 anticipated. Two Handles that share words can be told apart by owner name.
- **Claimed Handles become enumerable at a metered rate.**
  - Five results per query and 60 queries per 10 minutes per client address bound how fast one client can walk the index.
  - Many addresses walk it faster.
  - This is accepted and rate-limited, not prevented.
- **The route must prove its limits.** Integration tests must show that:
  - held, unclaimed and Reserved Handles never appear
  - the caps hold
  - the 61st request in a window gets `429`
  - `api-boundaries.test.ts` gains the `search.read` case
- **The search box is a combobox** with arrow, Enter and Escape handling, and `/` focuses it. It needs an axe check on both E2E projects.
- **The privacy notice gains one sentence**, and the owner's review of the legal pages covers it.
- **Not decided here, and each needs a new ADR:**
  - a per-Profile opt-out from search
  - searching by display name
  - any ranking beyond decision 5
- **Follow-up:** [#254](https://github.com/joshstothard/3moji/issues/254) builds the search after the brand pass ([#251](https://github.com/joshstothard/3moji/issues/251)).
- **Current-state impact:** `docs/architecture/system-overview.md`, `docs/architecture/auth.md` and `docs/architecture/data-model.md` are updated alongside this ADR, and every change is marked planned rather than built.

## Related

- Workstream: [3moji MVP](../workstreams/3moji-mvp.md)
- Issues: [#254](https://github.com/joshstothard/3moji/issues/254), [#200](https://github.com/joshstothard/3moji/issues/200)
- ADRs: [ADR-0008](./0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md) (the listing and ranking questions), [ADR-0011](./0011-canonical-word-aliases-name-one-handle-and-unclaimed-aliases-list-claimable-handles.md) (the canonical alias results show)
- Architecture: [system-overview.md](../architecture/system-overview.md), [auth.md](../architecture/auth.md), [data-model.md](../architecture/data-model.md)
