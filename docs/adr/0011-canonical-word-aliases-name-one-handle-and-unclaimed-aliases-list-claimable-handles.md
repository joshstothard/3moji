# ADR-0011: Every canonical word alias names exactly one Handle, and an ambiguous unclaimed alias lists what can be claimed

**Status:** Accepted
**Date:** 2026-09-14

## Context

[ADR-0008](./0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md) gives every Handle a dot-separated word alias. Decision 3 makes the **canonical** alias, the one the product publishes, copies and prints, the three `displayName` slugs joined by dots. Decision 4 decides an alias's response from how many **claimed** Handles it matches. On 2026-09-14 the repo owner accepted two follow-ups:

- the shareable word address should prefer a shorter name where it matches only one Handle
- an alias matching several unclaimed Handles should show a listing of them, each with a way to claim it ([#121](https://github.com/joshstothard/3moji/issues/121), option 1)

The shorter-name rule was then measured against the curated data on `main` at `04d391b`, which covers 307 released emoji and 937 term slugs.

**Five canonical aliases do not name one Handle.** Five `displayName` slugs also name a second emoji:

| Emoji | `displayName` slug | Also names |
| ----- | ------------------ | ---------- |
| 🦇    | `bat`              | 🏓         |
| 🐋    | `whale`            | 🐳         |
| 🦗    | `cricket`          | 🏏         |
| 🌼    | `blossom`          | 🌸         |
| 🍨    | `ice-cream`        | 🍦         |

Each triple alias, such as `bat.bat.bat`, resolves to **8 Handles**. The share link a 🦇🦇🦇 Profile copies renders that Profile only while none of the other seven candidates is claimed. Once one is, the same link becomes a listing, so a link in somebody's bio silently changes meaning.

**"Shortest term that names one emoji", applied everywhere, publishes wrong names.** It changes 156 of 307 emoji, often to a different animal or thing: 🐴 `pony`, 🦌 `doe`, 🐇 `hare`, 🦘 `wallaby`, 🐁 `mice`. Restricted to the `displayName` and CLDR name, it still changes 25, including 🧊 to `ice`, the defect [ADR-0005](./0005-the-emoji-set.md) decision 3's curated layer exists to prevent. It also reverts 🍆's curated `aubergine` to `eggplant`. The rule does not shorten the case that prompted it: `apple` names both 🍎 and 🍏, so 🍎🍎🍎 stays `red-apple.red-apple.red-apple` under any version. The owner chose the narrower fix when shown these numbers.

**ADR-0008 decision 4's `none` row assumes the alias names one Handle.** An emoji URL always does, but `apple.apple.apple` names eight. With none claimed there is no single Handle to offer a claim for, and decision 4 omits unclaimed Handles from a listing. As built, the page shows a single line with nothing to act on.

## Options considered

| Option                                                                                                                     | Pros                                                                                                 | Cons                                                                |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Keep `displayName` slugs, and use a curated `aliasName` only where the display name names more than one emoji (chosen)** | 5 of 307 aliases change, curated wording is kept, and every canonical alias names exactly one Handle | One more curated field whose changes break URLs                     |
| Shortest term that names one emoji, everywhere                                                                             | Mean term length falls from 9.4 to 6.3 characters                                                    | Publishes wrong names, changes 156 aliases, and does not shorten 🍎 |
| No change to decision 3                                                                                                    | Nothing to build                                                                                     | Five share links can silently turn into listings                    |
| For several unclaimed candidates: **list the Handles that can be claimed (chosen)**                                        | The visitor picks which one they meant; matches the claimed listing                                  | A populated-looking page for an alias nobody holds                  |
| For several unclaimed candidates: offer the claim for the canonical candidate                                              | One subject                                                                                          | Steers every claimant onto the same Handle                          |

## Decision

1. **A canonical alias names exactly one Handle.** Each position uses that emoji's `displayName` slug when that slug names only that emoji. Otherwise it uses the emoji's curated `aliasName`: a term already among that emoji's own terms (`displayName`, CLDR name, plural or synonyms) that names only that emoji.
2. **The initial `aliasName` values are** 🦇 `bats`, 🐋 `whales`, 🦗 `grasshopper`, 🌼 `flower` and 🍨 `sundae`.
3. **A test enforces decision 1 over the whole released set.** It fails if:
   - any canonical alias resolves to anything other than exactly one Handle
   - an `aliasName` names more than one emoji
   - an `aliasName` is not one of its emoji's own terms
   - an `aliasName` is set where the `displayName` slug is already unique

   A category release that introduces a new clash therefore fails CI until the clash is curated.

4. **The canonical alias does not otherwise prefer a shorter word.** Every other emoji keeps its `displayName` slug.
5. **An alias with more than one candidate and none claimed renders a listing of the candidates that can be claimed.**
   - Each row shows the Handle's emoji and Spoken Name, and links to that Handle's emoji path, where the existing claim call to action lives.
   - Held and Reserved candidates are omitted.
   - When no candidate can be claimed, the page says so and offers the Find a Handle lookup.
   - Rows follow the resolver's candidate order, and the page declares no `rel="canonical"`, as the claimed listing does not.
6. **The rest of ADR-0008 decision 4 stands.** An alias whose single candidate is unclaimed renders that Handle's claim call to action. One claimed match renders the Profile in place. Several claimed matches render the claimed listing, which still omits unclaimed and Reserved Handles.

## Consequences

- **This partially supersedes ADR-0008**: decision 3's "the canonical alias joins the three `displayName` slugs", and decision 4's `none` row when the alias has more than one candidate. The rest of ADR-0008 still applies.
- **Every share link now means one Handle for as long as the curation test is green.** The old spellings, such as `bat.bat.bat`, keep resolving to their candidate sets. At the time of writing only the owner has claimed a Handle, so no shared link changes meaning in practice.
- **`aliasName` joins `displayName` as a URL-stability concern.** Changing either for a released emoji changes a published canonical alias, which ADR-0008 already treats as a breaking URL change.
- **A claim listing can reach ADR-0008's worst measured case of 64 rows** (`celebration`). This is accepted because the listing appears only when nobody holds any of those Handles.
- **The Phase 4 criterion "none renders the claim call to action" can be ticked once this is built.**
- **Follow-up work:** one issue to implement decisions 1 to 5:
  - the `aliasName` curation field and its five values
  - `canonicalAliasOf`
  - the enforcing test
  - the claim listing on `apps/web/src/app/[handle]/page.tsx`, with observed-red unit and E2E tests and an axe check
- Current-state impact: `docs/architecture/system-overview.md` § The word alias and `docs/architecture/data-model.md` are updated alongside this ADR, and the new behaviour is marked planned rather than built.

## Related

- Workstream: [3moji MVP](../workstreams/3moji-mvp.md)
- Issues: [#121](https://github.com/joshstothard/3moji/issues/121)
- Supersedes: [ADR-0008: Handles are addressable by emoji and by their word alias](./0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md), decisions 3 and 4 in part only
- Architecture: [system-overview.md](../architecture/system-overview.md), [data-model.md](../architecture/data-model.md)
