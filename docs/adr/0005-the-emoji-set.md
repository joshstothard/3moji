# ADR-0005: The Emoji Set

**Status:** Accepted, partially superseded by ADR-0007
**Date:** 2026-09-12

> Decision 1 partially superseded by [ADR-0007: Release the Emoji Set in category drops](./0007-release-the-emoji-set-in-category-drops.md) on 2026-09-12: a Handle draws from the released categories, not the whole 1,053. The pin, the constraints and the candidate list are unchanged, and the rest of this ADR still applies.

## Context

Every Handle is drawn from a fixed set of emoji. An emoji that renders as a blank box on one platform, or as a materially different picture, breaks the product's core promise that a Handle can be shown and said anywhere. [The Emoji Set report](../reports/2026-09-11-emoji-set.md) derived the candidate set mechanically from Unicode's own data files and established which OS releases support which Emoji version.

A separate problem surfaced while prototyping: 🧊 has the official CLDR short name **"ice"**, not "ice cube". The product's founding pitch is "three ice cubes", so the canonical names alone cannot carry the spoken form.

## Options considered

| Option                      | Pros                                                               | Cons                                                        |
| --------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| **Pin Emoji 12.0** (chosen) | Renders on iOS 13.2+ and Android 10+, about 91% of Android devices | Excludes 131 newer emoji                                    |
| Pin Emoji 13.0              | 55 more emoji                                                      | Drops roughly 4 points of Android reach for a 5% larger set |
| Pin Emoji 11.0              | About 2 points more Android reach                                  | Gives up 61 emoji for a version with a small share          |

## Decision

1. **Pin the Emoji Set to Emoji 12.0: 1,053 single-codepoint emoji.** Excluded by construction: skin-tone modifiers, ZWJ sequences, flags, keycaps, and anything requiring a variation selector to display as emoji. This yields roughly 1.17 billion three-emoji Handles.
2. **The CLDR short name is the canonical Spoken Name and is immutable**, so the set stays reconcilable with Unicode.
3. **A curated layer sits on top, holding names only**: a `displayName` defaulting to the canonical name, search `synonyms`, and a stored plural for the collapsed spoken form. This is what lets the product say "three ice cubes" when the canonical name is "ice", and what lets a search for "ice cube" find 🧊. Override only where the canonical name reads badly aloud, so this is a review pass rather than authoring a thousand names.
4. **No colour field.** It was considered for swap suggestions and rejected: colour cannot be derived, because the same emoji renders in different colours on Apple and Google, and an authored value could never be verified. Suggestions use the `group` already present in the data.
5. **The Reserved Handle list ships as versioned data beside the set**, in `packages/core`, so every change is reviewable in git history. It holds nine emoji blocked wherever they appear, plus brand-like and platform-owned entries. Additions apply to future Claims only.

## Consequences

- The pin is a yearly review. Moving it to Emoji 13.0 becomes the better trade once Android 10 falls below roughly 3% of devices.
- The plural must be stored rather than derived: English plurals are not mechanical, and the set is small enough to write down.
- Curating display names is real work before Phase 3 can ship a picker that speaks correctly.
- **One question stays open** and is settled by a side-by-side render on real devices (issue #23): whether the alphanumeric and geometric symbol subgroups remain. Excluding both would take the set from 1,053 to 994. The evidence for cross-platform divergence is a 2016 study, which is why this needs eyes rather than another report.

## Related

- Report: [Emoji Set candidate](../reports/2026-09-11-emoji-set.md)
- Workstream: [3moji MVP](../workstreams/3moji-mvp.md)
- Issues: #9, #25, #23, #8
- Architecture: [data-model.md](../architecture/data-model.md)
