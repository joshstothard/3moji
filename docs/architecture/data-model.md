# Data model

**Partly built.** The four tables Better Auth owns exist in `packages/core/src/db/schema.ts`, with their migration in `packages/core/migrations/`. The Emoji Set ships as data in `packages/core/src/emoji/`. Everything below about Handles, Profiles and Links is still planned. The shape is decided in [ADR-0004](../adr/0004-the-handle-model.md) and [ADR-0005](../adr/0005-the-emoji-set.md); vocabulary is defined in [`CONTEXT.md`](../../CONTEXT.md).

## Account

A login identified by email and password. **Every live Account owns exactly one Handle**; account creation and the Handle's hold are one atomic act, so neither exists without the other ([ADR-0004](../adr/0004-the-handle-model.md)).

Releasing a Handle therefore deletes the Account, along with its Profile and Links. There is no handle-less Account.

## Handle

An ordered sequence of emoji from the Emoji Set. Only three-emoji Handles are claimable at launch; one- and two-emoji Handles are Reserved. Repetition is allowed, and all-same triples are freely claimable.

**Canonical key.** Decode the URL path once, apply NFC, strip U+FE0E and U+FE0F, split into code points, and require every one to be in the Emoji Set. That code-point sequence is the key, stored under a `UNIQUE` index with a deterministic collation. There is no separate display column: every emoji in the Set renders correctly as-is.

The application must canonicalise before every write, or the index does not mean what it appears to. A path that is not byte-identical to the encoded canonical form redirects permanently to it; one that cannot be canonicalised returns 404.

**Lifecycle.** Pick, then hold for 24 hours pending email verification, then claim. Holds expire lazily, evaluated when someone next attempts that Handle, with no scheduled job. An expired hold frees the Handle and deletes the unverified Account. A released Handle returns to the pool after 30 days. Handles cannot be changed in the MVP.

**Reserved Handles** are enforced in three independent layers: the domain layer, again inside the claim transaction, and finally the database constraint, which decides races between simultaneous claims.

## Profile

The public page a claimed Handle resolves to.

| Field        | Limit                  |
| ------------ | ---------------------- |
| Display name | 30 characters          |
| Bio          | 160 characters         |
| Links        | at most 10             |
| Link title   | 40 characters          |
| Link URL     | `http` or `https` only |

Limits are enforced in `packages/core`, not only in the form. Links are shown in an order the owner sets.

A visitor sees one of three states: the Profile itself; a claimed but unedited Handle, shown large with its Spoken Name; or a held Handle, which reveals neither who holds it nor when the hold expires. An **unclaimed** Handle is not a 404: it renders the home-page builder pre-filled with those three emoji and a call to claim it.

## Emoji Set

**Built.** Versioned data in `packages/core/src/emoji/`, pinned to Emoji 12.0: 1,053 single-codepoint emoji ([ADR-0005](../adr/0005-the-emoji-set.md)).

**A Handle may only use emoji from a _released category_** ([ADR-0007](../adr/0007-release-the-emoji-set-in-category-drops.md)). The candidate list stays at 1,053; what is claimable is the released subset.

|                          |                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Released at launch       | **Food & Drink** (113), **Animals & Nature** (126), **Activities** (68) — 307 emoji, 28,934,443 three-emoji Handles |
| Deferred, needs curation | Objects (183)                                                                                                       |
| Not scheduled            | Smileys & Emotion, People & Body, Travel & Places, Symbols                                                          |

Categories are released as **data, not code**: a drop is an edit to the released-category list plus a curation pass. A released category is **never withdrawn**, because withdrawing one could orphan a Handle somebody already owns.

### How it is laid out

| File                            | Role                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `emoji-candidate.ts`            | The `EmojiCandidate` shape and `EMOJI_SET_VERSION`, the Emoji 12.0 pin                                      |
| `emoji-candidates.generated.ts` | All 1,053 candidates. **Generated — never hand-edited**                                                     |
| `emoji-category.ts`             | `EMOJI_CATEGORIES` and `RELEASED_CATEGORIES`. **The released list is the drop**: one line per new category  |
| `emoji-set.ts`                  | Derives `candidateEmojiSet` and `releasedEmojiSet`, and exposes `findEmojiByCodepoint` / `isClaimableEmoji` |
| `emoji-curation.ts`             | The curated names, one row per released emoji. **Hand-authored — the counterpart to the generated file**    |
| `emoji-name.ts`                 | Resolves curation onto the released set into `CuratedEmoji`, and exposes `findCuratedEmoji` / `searchEmoji` |
| `spoken-handle.ts`              | `spokenHandle`, the collapsed spoken form — "three ice cubes"                                               |

`scripts/generate-emoji-set.mjs` (`npm run generate:emoji`) generates the candidate module from [the candidate report](../reports/2026-09-11-emoji-set.candidates.json), so the shipped data is derived rather than retyped; a domain test reparses the report and fails if the two drift. Releasing a category needs **no regeneration**: `released` is derived from `RELEASED_CATEGORIES` at load, so a drop is the one-line edit ADR-0007 decision 5 asks for.

`findEmojiByCodepoint` is keyed on the code point itself — the single-character string that splitting a canonicalised Handle path yields. The `U+XXXX` notation is carried as a field for provenance and is not a lookup key. The lookup returns unreleased entries too, so a caller can tell "not an emoji we know" from "not claimable yet"; `isClaimableEmoji` is what decides a Claim.

| Field         | Source                            | Purpose                                      |
| ------------- | --------------------------------- | -------------------------------------------- |
| `spokenName`  | CLDR short name, immutable        | Canonical identity                           |
| `displayName` | curated, defaults to `spokenName` | What the product says and shows              |
| `synonyms`    | curated, may be empty             | Search only                                  |
| `plural`      | curated, stored                   | The collapsed spoken form, "three ice cubes" |
| `article`     | curated, defaults to a vowel rule | "an ice cube", not "a ice cube"              |
| `group`       | Unicode                           | Theme, used for swap suggestions             |

### The curated name layer

**Built**, for the three released categories: 307 rows in `emoji-curation.ts`, keyed by code point.
ADR-0005 decision 3 puts a curated layer over the immutable CLDR names, because 🧊 is officially
called `ice` — so the product's own line, "three ice cubes", was neither its Spoken Name nor
findable by search.

`spokenName` stays exactly as Unicode gives it and is asserted against the candidate report; the
curated fields sit beside it on `CuratedEmoji` rather than widening `EmojiSetEntry`.

**Curation is per-drop, not per-set.** There is one row per _released_ emoji and only for released
emoji, so releasing a category is the one-line edit to `RELEASED_CATEGORIES` **plus** its rows here.
A test asserts the row set equals the released set exactly, which makes a half-finished drop red
rather than silent. Each row also repeats the CLDR name it is curating, because the set contains
near-identical glyph pairs (🐵/🐒, 🐶/🐕, 🐱/🐈) and a mis-keyed row would otherwise satisfy every
other assertion while making the product say the wrong name.

**Overriding is the exception.** 29 of the 307 display names are overridden; the rest default to the
CLDR name. The shapes that earn an override are a single word that is not an object (`ice`,
`cooking`, `tennis`), a name that is a category rather than a thing (`hot beverage`, `video game`,
`performing arts`), and a mass noun that cannot take a count (`bread` → "loaf of bread"). A name
being merely _plural_ is not one of them: `article` carries `"none"` instead, so 🥢 reads
"chopsticks" rather than "a pair of chopsticks".

**The plural is stored, never derived** (ADR-0005): a suffix rule gives "cherrys" and "three ices".
The `article` defaults to a vowel-letter rule and is overridden only where pronunciation disagrees
with spelling — "a unicorn", "a ewe".

### Saying a Handle aloud

`spokenHandle` takes the code points of a Handle, in order, and returns the collapsed spoken form,
or `undefined` if any of them is not claimable.

Runs collapse **only when consecutive**, because a Handle is an ordered sequence and two Handles
differ if their order differs: 🧊🧊🍕 is "two ice cubes and a pizza" while 🧊🍕🧊 is "an ice cube, a
pizza and an ice cube". The all-same triple the product pitch is built on is just a run of three, so
"three ice cubes" falls out of the same rule rather than being a special case.

There is deliberately no colour field: colour differs between Apple and Google and could never be verified.

The Reserved Handle list ships beside the Set as versioned data: nine emoji blocked wherever they appear, plus brand-like and platform-owned entries. Additions apply to future Claims only.
