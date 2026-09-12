# Data model

**Partly built.** The four tables Better Auth owns exist in `packages/core/src/db/schema.ts`, and the `handle` table — the first we design ourselves — in `packages/core/src/db/handle.ts`, with their migrations in `packages/core/migrations/`. The Emoji Set ships as data in `packages/core/src/emoji/`. The **table** a Handle lives in is built; the claim, hold-expiry and release **flows** that write to it are not, and neither are Profiles and Links. The shape is decided in [ADR-0004](../adr/0004-the-handle-model.md) and [ADR-0005](../adr/0005-the-emoji-set.md); vocabulary is defined in [`CONTEXT.md`](../../CONTEXT.md).

## Account

A login identified by email and password. **Every live Account owns exactly one Handle**; account creation and the Handle's hold are one atomic act, so neither exists without the other ([ADR-0004](../adr/0004-the-handle-model.md)).

Releasing a Handle therefore deletes the Account, along with its Profile and Links. There is no handle-less Account.

## Handle

An ordered sequence of emoji from the Emoji Set. Only three-emoji Handles are claimable at launch; one- and two-emoji Handles are Reserved. Repetition is allowed, and all-same triples are freely claimable.

**Canonical key. Built** — `canonicalise` in `packages/core/src/handle/canonicalise.ts`. Decode the URL path once, apply NFC, strip U+FE0E and U+FE0F, split into code points, and require exactly three, each in a **released** category. That code-point sequence is the key, stored under a `UNIQUE` index with a deterministic collation. There is no separate display column: every emoji in the Set renders correctly as-is.

The application must canonicalise before every write, or the index does not mean what it appears to. A path that is not byte-identical to the encoded canonical form redirects permanently to it; one that cannot be canonicalised returns 404.

`canonicalise` **returns a result, it does not throw**: every rejection is an ordinary answer to a public request, and "redirect to the canonical spelling" is a different branch from "404". A success carries the `key`, the `encoded` canonical segment (what a `Location` header must be given — a raw emoji in a header throws), `isCanonical` (whether the received segment was byte-identical to `encoded`, a **routing** answer that a non-URL caller should ignore), and the three Emoji Set entries in order. A rejection carries one of four reasons, which are deliberately different answers:

| Reason                | Means                                                        |
| --------------------- | ------------------------------------------------------------ |
| `malformed-encoding`  | `decodeURIComponent` threw — the segment is not even text    |
| `wrong-length`        | Not exactly three code points, Reserved lengths included     |
| `unknown-codepoint`   | Not in the candidate list: a letter, ZWJ, skin-tone modifier |
| `unreleased-category` | A real Emoji Set entry whose category has not dropped yet    |

Membership is checked left to right and the **leftmost** offender is reported, so the reason is a function of the input alone and not of the order of the candidate data.

**The rule says NFC, and callers must not "help" by applying NFKC.** Compatibility normalisation is not the identity over the candidate list: it rewrites 13 Symbols emoji into plain CJK characters (U+1F233 🈳 becomes U+7A7A 空), turning a real emoji into an unknown code point. NFC and NFD are both the identity over all 1,053 candidates, and a test asserts that so a future candidate with a canonical decomposition turns red.

**Lifecycle.** Pick, then hold for 24 hours pending email verification, then claim. Holds expire lazily, evaluated when someone next attempts that Handle, with no scheduled job. An expired hold frees the Handle and deletes the unverified Account. A released Handle returns to the pool after 30 days. Handles cannot be changed in the MVP.

## Reserved Handles

**Partly built.** The list is versioned data in `packages/core/src/handle/reserved-handles.ts`, and its domain guard is `claimableHandle` in `packages/core/src/handle/claimable.ts`. [ADR-0004](../adr/0004-the-handle-model.md) decision 7 requires **three independent layers**. Two exist today:

| Layer                                 | Where                                                                        | Status                       |
| ------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------- |
| Domain, before any write              | `claimableHandle` (`src/handle/claimable.ts`)                                | **Built**                    |
| Re-check inside the claim transaction | the claim use case                                                           | **Deferred to Phase 3**      |
| Database constraint                   | `handle_key_no_blocked_emoji` on `handle.key` (`src/db/handle.ts`, `0002_…`) | **Built**, for the nine only |

The middle layer is deliberately not built: there is no claim path yet, and a transaction wrapper with nothing calling it would be a third layer on paper only. The seam is named in `claimableHandle`'s doc comment — **the claim transaction must call `reservationOf` on the canonical key inside its own transaction** before inserting. Until it does, the database `CHECK` and the primary key are what decide a race.

[Issue #18](https://github.com/joshstothard/3moji/issues/18) settled the list as **three mechanisms, not one list**:

| Mechanism        | What                                                         | Enforced by                                      |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------------ |
| Rules            | Every one- and two-emoji Handle is Reserved                  | `canonicalise`, as `wrong-length` — not the list |
| Blocked emoji    | Nine emoji, reserved wherever they appear                    | The domain guard **and** the `CHECK`             |
| Reserved entries | Eight brand-like triples, three platform-owned, plus reports | The domain guard only                            |

**Only the blocked emoji reach the database layer.** They are a rule — "wherever they appear" — which is what a `CHECK` expresses well, and they are the half that protects people. The entries are the half that grows case by case, and a migration per addition would buy nothing the domain guard does not already give.

**Most of the list is forward-looking today, and the data says so.** ADR-0007 released only Food & Drink, Animals & Nature and Activities, so **two of the nine blocked emoji are reachable**: 🔫 water pistol (Activities) and 🔪 kitchen knife (Food & Drink). The other seven — 🖕 (People & Body) and 💣 🪓 💉 💊 🚬 🩸 (Objects) — are already rejected as `unreleased-category` before the list is consulted. Likewise **two of the eight brand-like triples** are reachable: 🍎🍎🍎 and 🐦🐦🐦. The platform-owned entries are drawn only from released categories, because their job is to stop a squatter taking something the product needs now. 🧊🧊🧊 is deliberately **not** reserved: ADR-0004 decision 2 names it as freely claimable. Tests pin which entries are reachable, so a later drop is a visible change to this list rather than a silent one.

**Additions apply to future Claims only, structurally.** Nothing on the resolve path — `canonicalise`, `toHandleKey`, the primary key — reads the reserved list, so a reserved Handle still resolves and an Account that already owns one keeps its Profile and its URL. Taking a claimed Handle away is a deliberate takedown, not a list edit. One consequence to carry forward: adding an emoji to the blocked nine later needs a **hand-written `ALTER TABLE … ADD CONSTRAINT … NOT VALID`** migration, because `ADD CONSTRAINT … CHECK` validates existing rows.

### How it is stored

`packages/core/src/db/handle.ts`, migration `0001_handle_table`.

| Column       | Type                         | Why                                                                                                                                       |
| ------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `key`        | `text collate "C"`, PK       | The canonical code-point sequence. Primary key, so uniqueness cannot be dropped without dropping the table                                |
| `user_id`    | `text`, `UNIQUE`, FK cascade | The owning Account. Unique gives the _at most one Handle per Account_ half of ADR-0004 decision 4; cascade makes Release account deletion |
| `held_until` | `timestamptz`, no default    | When the hold dies. Supplied from the injected `Clock`, never defaulted in SQL, or the 24-hour rule lives where no test can move time     |
| `claimed_at` | `timestamptz`, nullable      | When the Claim became final. `NULL` **is** what "still held" means, so lazy expiry reads `claimed_at IS NULL AND held_until < now()`      |
| `created_at` | `timestamptz`, `now()`       | An audit fact. There is no `updated_at`: decision 6 rules out changing a Handle, so the only mutation is `claimed_at` filling in          |

**The collation is stated on the column, not only on an index.** A Postgres `UNIQUE` index is byte equality _under a collation_, and the database's default collation belongs to the deployment — Neon in production, `postgres:16` in CI. `"C"` is deterministic by definition and identical everywhere, and pinning it on the column means the primary key and every future index and `WHERE key = …` inherit it. Drizzle's `text` has no collation option, so the column is a `customType` whose `dataType` is the full `text collate "C"`.

**The canonicalise-before-every-write rule is carried by the type system.** `packages/core/src/db/handle-key.ts` brands the key as `HandleKey`, and the only exported ways to obtain one — `toHandleKey(segment)` and `handleKeyOf(canonicalHandle)` — both run `canonicalise`. Writing a raw request parameter into the key column does not compile. It is a speed bump rather than a wall: a deliberate assertion still gets past any TypeScript brand, which is why the database keeps the last word.

**`CHECK (char_length(key) = 3)`** is the third of decision 7's independent layers, in the place that decides. `char_length` counts code points and every Emoji Set entry is a single code point, so three code points is exactly three emoji — and it catches the specific bug ADR-0004 fears most, a stray U+FE0F surviving canonicalisation to the write, even when both earlier layers are wrong.

**The owning Account is Better Auth's `user` row, not its `account` row.** The domain Account of `CONTEXT.md` is the login; Better Auth's `account` table is one row _per credential provider_ for a user, so a foreign key there would delete somebody's Handle when a provider row was removed.

**Open: the 30-day cooldown has nowhere to live.** Release is account deletion and the Handle row cascades away with the Account, so a released Handle leaves nothing behind to date a cooldown from. The lifecycle above therefore describes a rule the schema does not yet record. Phase 3's release flow needs a deliberate decision — a tombstone row written at deletion is the obvious shape — and it was left out here rather than being invented as a table with nothing writing to it.

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

The Reserved Handle list ships beside the Set as versioned data, in `src/handle/reserved-handles.ts` rather than `src/emoji/`: it is a rule about Handles, not a property of an emoji, and it must not become something `canonicalise` consults. See [Reserved Handles](#reserved-handles) above.
