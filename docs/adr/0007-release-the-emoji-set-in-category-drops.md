# ADR-0007: Release the Emoji Set in category drops

**Status:** Accepted
**Date:** 2026-09-12

## Context

[ADR-0005](0005-the-emoji-set.md) pinned the Emoji Set to 1,053 single-codepoint emoji and left one question open: which of a flagged subset render too differently across platforms to keep. That question is answered by looking at real devices, and it carries a cost that ADR did not weigh.

**Shrinking the set is a one-way door.** Once an emoji is claimable and someone owns a Handle containing it, removing it either orphans their Handle or breaks the Reserved Handle rule. [ADR-0004](0004-the-handle-model.md) records the same asymmetry for all-same triples. Growing the set has no such cost: it is purely additive.

Measuring the set by how easily each name is said aloud shows the categories differ sharply. Counting names that need three or more words, and names that collide with three or more others on their first word:

| Category          | Emoji | Names needing 3+ words | First-word collisions            |
| ----------------- | ----: | ---------------------: | -------------------------------- |
| Animals & Nature  |   126 |                     3% | none                             |
| Food & Drink      |   113 |                    13% | none                             |
| Activities        |    68 |                    13% | none                             |
| Objects           |   183 |                    14% | musical, open, woman's           |
| Travel & Places   |   161 |                    19% | globe, oncoming                  |
| Smileys & Emotion |   139 |                    35% | face, grinning, kissing, smiling |

Flags were already excluded by ADR-0005's single-codepoint rule: they are regional-indicator pairs or ZWJ sequences. They are also the worst category for this product, because on several platforms a flag renders as two letters rather than a picture, and several carry live political disputes.

## Options considered

| Option                             | Pros                                                                                                     | Cons                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Stage by category** (chosen)     | Only curated emoji are ever claimable; the render check shrinks to the launch set; each drop is an event | Smaller namespace at launch; a staging mechanism to build                       |
| Release all 1,053, exclude later   | Largest namespace immediately                                                                            | Exercises the one-way door: an emoji found to render badly may already be owned |
| Release all 1,053, exclude nothing | Simplest                                                                                                 | Ships names nobody can say and glyphs that differ across platforms              |

## Decision

1. **A Handle may only use emoji from a released category.** This **partially supersedes [ADR-0005](0005-the-emoji-set.md) decision 1**: the pin to Emoji 12.0, the single-codepoint constraints and the 1,053-emoji candidate list all stand unchanged, but the set a Handle draws from is the released subset rather than the whole list.
2. **Launch with three categories: Food & Drink, Animals & Nature, Activities.** 307 emoji, giving 28,934,443 three-emoji Handles.
3. **Objects is deferred to a later drop and requires curation first.** It contains four near-identical discs (`computer disk`, `optical disk`, `floppy disk`, `dvd`) plus a trackball, pager, fax machine and videocassette, which defeat saying a Handle aloud even when correctly named.
4. **Smileys & Emotion and People & Body are not scheduled.** Smileys has the worst name collisions in the set and is where the documented cross-platform divergence lives. People & Body carries skin-tone base characters and ambiguous person variants.
5. **Categories are released as data, not code.** A drop is an edit to the released-category list plus a curation pass, reviewable in a pull request.
6. **A released category is never withdrawn.** Removing one would exercise the door this ADR exists to avoid.

## Consequences

- The render check (issue #23) shrinks from the whole set to three categories, and is a launch blocker only for those.
- Each drop is a marketing moment, which suits a scarcity product.
- Scarcity is deliberate: 28.9 million Handles is far more than the MVP needs, and a smaller namespace makes a Handle worth more.
- **Food & Drink being a launch category makes the peach and aubergine prominent.** Both were left claimable ([#18](https://github.com/joshstothard/3moji/issues/18)) on the grounds that context makes them rude and context is what reporting is for. That is worth revisiting now they are front and centre rather than buried among a thousand, and it is recorded as an open question on the workstream rather than settled here.
- Curating Objects becomes a prerequisite for drop two, not for launch.
- `CONTEXT.md`'s Emoji Set definition changes: the allowlist is the released categories, not every safe emoji.

## Related

- Report: [Emoji Set candidate](../reports/2026-09-11-emoji-set.md)
- Workstream: [3moji MVP](../workstreams/3moji-mvp.md)
- Issues: #23, #18, #8
- Partially supersedes: [ADR-0005: The Emoji Set](0005-the-emoji-set.md)
- Architecture: [data-model.md](../architecture/data-model.md)
