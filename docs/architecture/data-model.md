# Data model

**Partly built.** The four tables Better Auth owns exist in `packages/core/src/db/schema.ts`, and the `handle` table — the first we design ourselves — in `packages/core/src/db/handle.ts`, with their migrations in `packages/core/migrations/`. The Emoji Set ships as data in `packages/core/src/emoji/`. The **table** a Handle lives in is built, and so is [the Claim](#the-claim) that writes to it — as a domain path, with no user interface in front of it yet. **Lazy hold expiry is built**, as the write inside that Claim (see [Expiring a hold](#expiring-a-hold)). **Release is built** — account deletion and the `released_handle` tombstone, as a domain path with no account surface in front of it yet (see [The release tombstone](#the-release-tombstone)). **The `profile` and `link` tables are built**, with the read path that resolves a Handle to its Profile (see [Profile](#profile)); no write path and no Profile page yet. **Their field limits are built too** — `packages/core/src/profile/validate-profile.ts`, pure, and ahead of the form that will call it (see [Profile](#profile)). The shape is decided in [ADR-0004](../adr/0004-the-handle-model.md) and [ADR-0005](../adr/0005-the-emoji-set.md); vocabulary is defined in [`CONTEXT.md`](../../CONTEXT.md).

## Account

A login identified by email and password. **Every live Account owns exactly one Handle**; account creation and the Handle's hold are one atomic act, so neither exists without the other ([ADR-0004](../adr/0004-the-handle-model.md)).

Releasing a Handle therefore deletes the Account, along with its Profile and Links. There is no handle-less Account.

## Handle

An ordered sequence of emoji from the Emoji Set. Only three-emoji Handles are claimable at launch; one- and two-emoji Handles are Reserved. Repetition is allowed, and all-same triples are freely claimable.

**Canonical key. Built** — `canonicalise` in `packages/core/src/handle/canonicalise.ts`. Decode the URL path once, apply NFC, strip U+FE0E and U+FE0F, split into code points, and require exactly three, each in a **released** category. That code-point sequence is the key, stored under a `UNIQUE` index with a deterministic collation. There is no separate display column: every emoji in the Set renders correctly as-is.

The application must canonicalise before every write, or the index does not mean what it appears to. An emoji path that is not byte-identical to the encoded canonical form redirects permanently to it. A segment that cannot be canonicalised returns 404 **unless it resolves as a word alias** — ADR-0004 decision 1 returned 404 unconditionally, and [ADR-0008](../adr/0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md) supersedes that clause alone.

`canonicalise` **returns a result, it does not throw**: every rejection is an ordinary answer to a public request, and "redirect to the canonical spelling" is a different branch from "404". A success carries the `key`, the `encoded` canonical segment (what a `Location` header must be given — a raw emoji in a header throws), `isCanonical` (whether the received segment was byte-identical to `encoded`, a **routing** answer that a non-URL caller should ignore), and the three Emoji Set entries in order. A rejection carries one of four reasons, which are deliberately different answers:

| Reason                | Means                                                        |
| --------------------- | ------------------------------------------------------------ |
| `malformed-encoding`  | `decodeURIComponent` threw — the segment is not even text    |
| `wrong-length`        | Not exactly three code points, Reserved lengths included     |
| `unknown-codepoint`   | Not in the candidate list: a letter, ZWJ, skin-tone modifier |
| `unreleased-category` | A real Emoji Set entry whose category has not dropped yet    |

Membership is checked left to right and the **leftmost** offender is reported, so the reason is a function of the input alone and not of the order of the candidate data.

**The rule says NFC, and callers must not "help" by applying NFKC.** Compatibility normalisation is not the identity over the candidate list: it rewrites 13 Symbols emoji into plain CJK characters (U+1F233 🈳 becomes U+7A7A 空), turning a real emoji into an unknown code point. NFC and NFD are both the identity over all 1,053 candidates, and a test asserts that so a future candidate with a canonical decomposition turns red.

**A Handle has one identity and two addresses. Built** — `resolveAlias` and `canonicalAliasOf` in `packages/core/src/handle/alias.ts` ([ADR-0008](../adr/0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md)). The canonical key above is the identity. The second address is the **word alias**: three dot-separated term slugs, `ice-cube.ice-cube.ice-cube`, which exists because the emoji URL cannot survive an autolinker. It is a **derived lookup over the curated names — no column, no migration, no second uniqueness constraint**, and nothing on the write path consults it. One Handle has many accepted aliases (any of an emoji's terms in any position — 937 distinct term slugs over the 307 released emoji, 907 of them naming exactly one) and exactly one canonical alias, which always names exactly one Handle ([ADR-0011](../adr/0011-canonical-word-aliases-name-one-handle-and-unclaimed-aliases-list-claimable-handles.md), built in [#248](https://github.com/joshstothard/3moji/issues/248)). Each position is that emoji's `displayName` slug. A position whose slug also names another emoji uses the emoji's curated `aliasName` instead: an optional field on the curation row, one of its own terms that names only it. Five emoji carry one: 🦇 `bats`, 🐋 `whales`, 🦗 `grasshopper`, 🌼 `flower` and 🍨 `sundae`. A curation test in `alias.test.ts` fails the build on any clash left uncurated. Resolution is ambiguous where the parse is not: `apple` names both 🍎 and 🍏, so `apple.apple.apple` names eight Handles, and the resolver returns all eight rather than choosing. The parse is unambiguous because slugging collapses every non-alphanumeric run to `-`, so no term slug can contain the separator — asserted over every indexed slug in `alias.test.ts`, not merely argued. See Routing in [system-overview.md](system-overview.md).

**Alias stability is coupled to curation, which makes curation no longer cosmetic.** `displayName` is curated and mutable — 29 of 307 are overridden — so renaming one silently changes every alias containing it and breaks links already in people's bios. Deriving aliases from the immutable CLDR `spokenName` would avoid that at the cost of `/ice.ice.ice`, the exact defect the curated layer exists to fix. A display-name change is therefore a **breaking URL change** and needs the old alias retained as a redirect. The curated `aliasName` ([ADR-0011](../adr/0011-canonical-word-aliases-name-one-handle-and-unclaimed-aliases-list-claimable-handles.md)) carries the same obligation.

**Lifecycle.** Pick, then hold for 24 hours pending email verification, then claim. The first step of that is built — see [the Claim](#the-claim) below. Holds expire lazily, evaluated when someone next attempts that Handle, with no scheduled job; an expired hold frees the Handle and deletes the unverified Account. **That is built too** — see [Expiring a hold](#expiring-a-hold). **A released Handle returns to the pool immediately — there is no cooldown in the MVP** ([ADR-0009](../adr/0009-release-leaves-a-tombstone-and-the-cooldown-is-dropped-for-the-mvp.md)); **that is built too**, and an integration test claims a Handle at the very instant it is released. Handles cannot be changed in the MVP.

## Reserved Handles

**Partly built.** The list is versioned data in `packages/core/src/handle/reserved-handles.ts`, and its domain guard is `claimableHandle` in `packages/core/src/handle/claimable.ts`. [ADR-0004](../adr/0004-the-handle-model.md) decision 7 requires **three independent layers**. Two exist today:

| Layer                                 | Where                                                                              | Status                       |
| ------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------- |
| Domain, before any write              | `claimableHandle` (`src/handle/claimable.ts`)                                      | **Built**                    |
| Re-check inside the claim transaction | `reservationOf`, inside `claimHandle`'s transaction (`src/handle/claim-handle.ts`) | **Built**                    |
| Database constraint                   | `handle_key_no_blocked_emoji` on `handle.key` (`src/db/handle.ts`, `0002_…`)       | **Built**, for the nine only |

**All three layers exist.** The middle one was deferred while there was no claim path to put it in — a transaction wrapper with nothing calling it would have been a layer on paper only — and the Claim closed it: `claimHandle` calls `reservationOf` on the canonical key **inside its own transaction**, before the insert, so a list read before the transaction opened cannot be stale by the time the row is written. Its test reserves the Handle _after_ the point a naive implementation would have checked, in the unit suite by flipping the list the instant the transaction opens and in `claim.integration.test.ts` by flipping it after a real `BEGIN` and then asserting neither row is there. The database `CHECK` and the primary key still decide a genuine race.

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
| `claimed_at` | `timestamptz`, nullable      | When the Claim became final. `NULL` **is** what "still held" means, so lazy expiry reads `claimed_at IS NULL AND held_until <= now`       |
| `created_at` | `timestamptz`, `now()`       | An audit fact. There is no `updated_at`: decision 6 rules out changing a Handle, so the only mutation is `claimed_at` filling in          |

**The collation is stated on the column, not only on an index.** A Postgres `UNIQUE` index is byte equality _under a collation_, and the database's default collation belongs to the deployment — Neon in production, `postgres:16` in CI. `"C"` is deterministic by definition and identical everywhere, and pinning it on the column means the primary key and every future index and `WHERE key = …` inherit it. Drizzle's `text` has no collation option, so the column is a `customType` whose `dataType` is the full `text collate "C"`.

**The canonicalise-before-every-write rule is carried by the type system.** `packages/core/src/db/handle-key.ts` brands the key as `HandleKey`, and the only exported ways to obtain one — `toHandleKey(segment)` and `handleKeyOf(canonicalHandle)` — both run `canonicalise`. Writing a raw request parameter into the key column does not compile. It is a speed bump rather than a wall: a deliberate assertion still gets past any TypeScript brand, which is why the database keeps the last word.

**`CHECK (char_length(key) = 3)`** is the third of decision 7's independent layers, in the place that decides. `char_length` counts code points and every Emoji Set entry is a single code point, so three code points is exactly three emoji — and it catches the specific bug ADR-0004 fears most, a stray U+FE0F surviving canonicalisation to the write, even when both earlier layers are wrong.

**The owning Account is Better Auth's `user` row, not its `account` row.** The domain Account of `CONTEXT.md` is the login; Better Auth's `account` table is one row _per credential provider_ for a user, so a foreign key there would delete somebody's Handle when a provider row was removed.

### The release tombstone

**Built** ([ADR-0009](../adr/0009-release-leaves-a-tombstone-and-the-cooldown-is-dropped-for-the-mvp.md)). `handle.user_id` cascades on delete, so deleting an Account takes its Handle row with it and leaves nothing to date a cooldown from. That contradiction in ADR-0004 decision 5 is resolved by dropping the cooldown rather than by enforcing it: **a released Handle returns to the pool immediately.**

Release still writes a `released_handle` row — the canonical key and a release timestamp, **and nothing else**. No `user_id`, no email, no Profile field, no foreign key to any Account: Release is account deletion, and a tombstone naming its former owner would make that promise true in letter and false in substance. The canonical key was a public URL already, so alone it identifies nobody. **That constraint is written in the table's own comment**, because adding a user reference later would silently undo account deletion.

The row exists because **time cannot be backfilled**: a cooldown switched on later with no history behind it starts blind. The write goes in the delete use case inside the deletion transaction, not a database trigger, because `drizzle-kit generate` owns this schema — the same trade taken for the blocked-emoji `CHECK`. The cost is that the database cannot enforce it, so a direct `DELETE` on a `user` row leaves no tombstone; the tombstone is evidence, not an invariant.

**Nothing reads it.** The claim path does not consult it, which is what makes "no cooldown" structural rather than asserted — there is no branch to get wrong and no stale row can block a legitimate claim. An integration test inserts a tombstone for a Handle nobody ever claimed and then claims it, so the day a read appears in the claim gate is the day that test goes red. Turning a cooldown on is a new ADR plus that read. Rows are never swept in the MVP (decision 6).

#### How it is stored

`packages/core/src/db/released-handle.ts`, migration `0004_released_handle_tombstone`.

| Column        | Type                      | Why                                                                                                                                                                      |
| ------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`          | `text`, PK                | The row's own identity — **not the key**. With no cooldown a Handle can be released, reclaimed and released again, so one key legitimately has several rows              |
| `key`         | `text collate "C"`        | The released canonical key, in the same column type `handle.key` uses (`handleKeyColumn`, imported rather than redeclared). Not unique and not indexed: nothing reads it |
| `released_at` | `timestamptz`, no default | When the Handle returned to the pool, from the injected `Clock`. A cooldown would be dated from this, so a SQL default would put it where no test can move time          |

#### Releasing

`releaseHandle` in `packages/core/src/handle/release-handle.ts`, over the `ReleaseStore` port (`src/ports/release-store.ts`) and its Drizzle adapter (`src/adapters/drizzle-release-store.ts`), wired as `releases` on the composition root.

One transaction does three things in this order, and the order is a rule: **read the Handle the Account owns**, write the tombstone, delete the `user` row. The read has to come first because `handle.user_id` cascades — after the delete there is no key left to record. Deleting the `user` row is what makes Release account deletion: the Handle, the sessions, the credential rows and the verification dispatches all cascade from it, and Phase 4's Profile and Links will hang off the same row.

It is a **separate port from the Claim's** rather than three more methods on `ClaimTransaction`: `deleteAccount` is not on the claim path, and putting it there would hand the Claim a verb for deleting somebody's Account. Better Auth is not rebound to this transaction the way the Claim rebinds it, because a Release writes no Better Auth row and sends no email — so Better Auth's own `deleteUser` API is bypassed and no library hook fires on deletion; the cascade is what the deletion actually needs.

The read takes a row lock (`SELECT … FOR UPDATE`), so two Releases of the same Account issued at once cannot both write a tombstone for one Release: the second waits, finds the row gone with the cascade, and answers `no-handle`. An id that owns no Handle answers `no-handle` and writes nothing: ADR-0004 decision 4 leaves only two ways to reach that — an id naming nobody, or a Release that already happened.

**There is no interface in front of it yet.** ADR-0004 decision 5 requires that the interface say plainly that releasing deletes the Account along with the Profile and its Links, rather than hiding it behind the word "release". There is no authenticated account surface to carry that copy until Phase 4.

## The Claim

**Built, and not runnable on the production driver.** `claimHandle` in `packages/core/src/handle/claim-handle.ts`, with `submitClaim` over it (`src/handle/submit-claim.ts`) and the `submitClaimAction` server action in `apps/web`. The hold screen, the verification landing and resend are built ([#82](https://github.com/joshstothard/3moji/issues/82)), and so is **the form in front of it** ([#115](https://github.com/joshstothard/3moji/issues/115)): the builder offers `claim-form.tsx` whenever its Handle reads as available, on `/` and on an unclaimed `/[handle]`, and the form posts to the action — see [system-overview.md](system-overview.md) § The claim form.

ADR-0004 decision 4 — _every live Account owns exactly one Handle_ — is an invariant about two rows in two tables, so it holds only if they are written together. Account creation and the hold are therefore **one transaction**, and every rejection rolls all of it back: a Claim that fails for any reason creates nothing, never an Account waiting for a Handle.

| Piece                            | Lives in                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------- |
| The use case and its result type | `packages/core/src/handle/claim-handle.ts`                                   |
| The unit-of-work port            | `packages/core/src/ports/claim-store.ts`                                     |
| Its Drizzle adapter              | `packages/core/src/adapters/drizzle-claim-store.ts`                          |
| Holding email until commit       | `packages/core/src/auth/adapters/deferred-email-sender.ts`                   |
| The wiring                       | `createCoreServices`, as `services.claims`                                   |
| Freeing an expired hold          | `freeExpiredHold` on the same port — see [Expiring a hold](#expiring-a-hold) |

**The writes exist only inside the transaction, structurally.** `HandleRepository` was deliberately read-only so that no caller could write a hold without a transaction, and `ClaimStore` keeps that property rather than restating it as a convention: it exposes one method, `runInTransaction`, and `createAccount` and `holdHandle` are reachable only on the object handed to its callback. The callback returns its verdict beside a commit decision instead of throwing, because a rejected Claim is an ordinary answer — the same argument `canonicalise` makes — while still having to roll back.

**Better Auth is rebound to the transaction.** Its Drizzle adapter issues every statement through the client it was constructed with, so the only way to get its `user` and `account` rows into our transaction is to construct an instance against the transaction. The composition root supplies that as a closure already holding the secret, base URL and sender address, so it stays the only place that calls `createAuth`. Signing up first and deleting the Account if the hold failed was rejected: that is a compensating write, and a process that dies between the two steps leaves exactly the handle-less Account the invariant forbids.

**An email cannot be rolled back.** Better Auth sends the verification email from inside sign-up, which is inside the transaction, so the Claim wraps the sender for the duration: emails are held, flushed after the commit, and discarded after a rollback. The flush itself is handed to the background as one task, so the email goes out after the response ([auth.md](auth.md#email-is-sent-after-the-response), #216). Without it every rejected Claim — a Handle lost to a race included — would send "verify your email to claim your handle" for an Account that never existed.

**`held_until` comes from the injected `Clock`** and the 24 hours is `HOLD_DURATION_MS`, a domain constant. The column has no SQL default on purpose; see its row in the table above.

An already-registered email is decided by a read **inside the transaction**, not from the sign-up response: Better Auth returns a synthetic success for one to prevent account enumeration ([#15](https://github.com/joshstothard/3moji/issues/15)), so its return value cannot distinguish the two. The domain answers `already-registered` and nothing is written — neither a second Account nor a hold that would take the Handle away from the person submitting. **The submitter is owed the same hold screen a new sign-up gets**, and `submitClaim` is where that promise is kept: it collapses `already-registered` into `pending`, so the case no longer exists in the type a transport sees, and it pads the fast branch to a 500 ms floor so the _timing_ does not answer the question either. The claim adapter hashes the submitted password even after deciding the address is taken, which is the same dummy-work trick Better Auth's own sign-in uses. The existing address is told by email instead, naming the Handle it already owns and linking to the reset **form** — not a tokenised reset link, because sign-up is unauthenticated and a tokenised link there would let a stranger have live reset tokens mailed to somebody else's inbox.

### Expiring a hold

**Built.** `ClaimTransaction.freeExpiredHold`, implemented in `packages/core/src/adapters/drizzle-claim-store.ts` and called from `claimHandle` **inside the claim transaction**.

ADR-0004 decision 3 expires holds **lazily** — evaluated when someone next attempts that Handle, with no scheduled sweep — so there is exactly one moment at which an expired hold can be cleared: the moment somebody tries to claim it. The read side already treats an expired hold as `available` (`ownershipOf`); this is the write that makes it true.

| Rule                                                           | How it is kept                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Freeing the Handle deletes the unverified Account (decision 5) | The write deletes the **`user` row**; `handle.user_id` cascades, so the Handle goes with it — along with Better Auth's `session` and `account` rows                                                                                                                  |
| A verified Account's Handle is never freed                     | The predicate is `claimed_at IS NULL AND held_until <= <injected now>`. **`claimed_at IS NULL` is what "still held" means**, so a finished Claim is untouchable whatever its `held_until` says                                                                       |
| The boundary instant is already expired                        | `<=`, matching `ownershipOf`, which frees a hold _at_ `held_until` rather than after it. An integration test pins that instant against the database                                                                                                                  |
| Time is injected                                               | `now` comes from the `Clock` the use case read once, never `now()` in SQL — the same reason `held_until` has no SQL default                                                                                                                                          |
| The order inside the transaction                               | The freeing write runs **before** `createAccount`. The Account being deleted may hold the address being submitted, by someone reclaiming their own expired Handle; a sign-up read that ran first would answer `already-registered` and they could never have it back |

**The rule is stated twice, deliberately.** `ownershipOf` decides what a reader is told, and the SQL predicate decides what is deleted, restating the condition rather than trusting the caller's verdict. An adapter that deleted on the caller's word would delete a verified Account the moment that verdict was wrong. The cost is two encodings of one rule, which is why their agreement on the boundary instant is tested on both sides.

**The row is locked `FOR UPDATE` before the delete.** Verification sets `claimed_at` on the same row, and under `READ COMMITTED` a plain `SELECT` can see a version another transaction is about to finalise. Locking makes that writer wait and Postgres re-evaluates the predicate against the new version, so a just-verified row stops matching. The verification flow now does write `claimed_at` ([#82](https://github.com/joshstothard/3moji/issues/82)), so the window is live rather than hypothetical. It is still not _contended_ by any test — provoking the interleaving needs two transactions held open against one row — so what is covered is the outcome either way: a finalised row is refused by this write, and an unfinalised one is freed, both asserted against a real database. The lock is what makes the race between them resolve correctly; the assertions are what make its absence noticeable.

**There is no sweep, and the absence is asserted.** `packages/core/src/handle/lazy-expiry.test.ts` fails if a workspace declares a scheduling dependency or a `vercel.json` grows a `crons` array, so adding one is a deliberate change with the ADR in the diff. The consequence ADR-0004 accepts stands: a Handle can appear held after its hold has died, until somebody tries it.

**One consequence for the verification flow, now met.** A stale verification link may find the hold row **gone entirely** rather than merely expired, because a later claimant's transaction deleted it — and with it the Account the link was for, and the dispatch rows that cascade from it. So the link becomes one we have no record of rather than one pointing at an expired hold, and `finaliseClaim` answers `link-unknown`. That screen therefore offers **both** a new link and picking again, and says both causes out loud: a resend alone would leave somebody waiting for an email that can never arrive, since there is no Account left to send it to.

### One driver runs it, in every environment

`drizzle-orm/neon-http` has **no interactive transactions** — it throws "No transactions support in neon-http driver" — and ADR-0006 decision 6 selected exactly that driver for production, while local development and CI resolved to `node-postgres`, which supports them. So the Claim passed in CI against `postgres:16` and could not have run on Vercel.

**[ADR-0010](../adr/0010-use-one-postgres-driver-in-every-environment.md) resolved it: `node-postgres` in every environment, on the pooled connection in production.** `resolveDriver` no longer branches on `NODE_ENV`, `@neondatabase/serverless` is removed so the driver cannot be selected by accident, and `db/transaction-capability.integration.test.ts` asserts the configured driver opens an interactive transaction, reads its own uncommitted writes and rolls back.

The point of the decision is not the transaction support but the divergence: a driver chosen by `NODE_ENV` meant CI exercised something production never ran, which is how four merged pull requests passed over a path that could not work. Migrations keep using the unpooled connection. Two things are **unverified and must not be presumed** — `node-postgres` on Vercel's serverless runtime, and whether transaction-mode pooling's lack of prepared statements affects Drizzle's `node-postgres` path; [#32](https://github.com/joshstothard/3moji/issues/32) owes the first. The adapter's diagnosis of that refusal is gone with the driver: an error that can no longer occur needs no translation, and a branch no test can reach is worse than none.

### Finalising the Claim

**Built** — `finaliseClaim` in `packages/core/src/auth/finalise-claim.ts`, over the `ClaimFinaliser` port and its Drizzle adapter, reached from `apps/web/src/app/claim/verify/route.ts` ([#82](https://github.com/joshstothard/3moji/issues/82)).

A Claim becomes final when the email is verified, and **that means two rows in two tables**: `user.email_verified` going true and `handle.claimed_at` filling in. They are written in **one transaction**, for the same reason the Claim itself is one — `claimed_at` is what ownership _means_, so an address verified without it leaves a Handle that still reads as held, and lazy expiry ([#83](https://github.com/joshstothard/3moji/issues/83)) would free it out from under somebody who did everything right.

The finalisation refuses a hold that has already expired, and `ownershipOf` decides that rather than a SQL predicate, so the 24-hour rule has exactly one implementation. A refusal rolls the verification back too: an Account whose hold died is one #83 deletes, and leaving it verified with no Handle is the state ADR-0004 decision 4 forbids.

It shares its transaction plumbing with the Claim (`packages/core/src/adapters/transactional-auth.ts`): Better Auth rebound to the transaction, the email sender deferred until the commit, and the dispatch store bound to the same transaction. The neon-http caveat below therefore applies to both ([#89](https://github.com/joshstothard/3moji/issues/89)).

## Verification dispatch

**Built** — `packages/core/src/db/verification-dispatch.ts`, migration `0003_verification_dispatch`.

One row per verification link issued: who for, when, and which link. It exists because **Better Auth's verification token is stateless**: `createEmailVerificationToken` signs a JWT carrying the address and an hour's expiry and stores nothing. So there is no row for a resend to delete, and every link the library has ever signed stays valid until it expires on its own. "Each resend invalidates the previous link" is not something the library can be configured into — it is a rule enforced against our own record of what we issued, or it is not enforced at all.

The same rows carry the resend rate limit, which is not two responsibilities bolted together: "three an hour, at most one a minute, per Account" is a question about the same facts. A serverless deployment has no process memory to hold them in, so they have to be rows.

### How it is stored

| Column       | Type                            | Why                                                                                                                                              |
| ------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`         | `text`, PK                      | A UUID from the adapter                                                                                                                          |
| `user_id`    | `text`, FK cascade              | The Account the link was issued to. Cascades, so a deleted Account leaves no trace here                                                          |
| `token_hash` | `text`, indexed, **not unique** | SHA-256 of the token, hex. **Never the token**, which is a bearer credential good for an hour                                                    |
| `sent_at`    | `timestamptz`, no default       | When it went out, from the injected `Clock` — the rate-limit window is a domain rule, and a SQL default would put it where no test can move time |

**`token_hash` is deliberately not `UNIQUE`.** Better Auth's JWT carries `iat` at one-second resolution and no nonce, so two tokens signed for the same address inside the same second are byte-identical. The one-a-minute floor makes that unreachable through the product, but a unique index would turn any future path that sent twice quickly into a constraint violation on a bookkeeping row — a hard failure in exchange for nothing, since duplicate rows here are indistinguishable from each other anyway. Both reads order newest-first and take one row.

**Rows are written in exactly one place**: the `sendVerificationEmail` hook in `createAuth`, which is the only point at which Better Auth reveals the token it signed. That is what makes "every link we issue is recorded" structural rather than a convention — a caller that could send without recording would silently revive an invalidated link. On the claim path the hook runs inside the claim transaction, so a rolled-back Claim leaves no dispatch behind, exactly as it leaves no Account.

## Claim rate limit

**Built** — `packages/core/src/db/claim-rate-limit.ts`, migration `0006_claim_rate_limit`.

How many Claim submissions one bucket has made in one fixed window ([#157](https://github.com/joshstothard/3moji/issues/157)). A bucket is a client address or an email address, and **neither is stored**: the rule, and why it is shaped this way, is in [auth.md](auth.md#the-claims-rate-limit). A serverless deployment has no process memory to count in, so the counts are rows.

### How it is stored

| Column         | Type                          | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bucket`       | `text`, PK part               | A kind — `client:` or `email:` for the Claim, `resend-client:` for resend (#158), `sign-in-client:` for the sign-in form (#180), `reset-request-client:` for the password reset request form (#192), and `search-client:` for the header search ([ADR-0012](../adr/0012-header-search-lists-claimed-handles-with-display-names-capped-and-rate-limited.md)) — then an HMAC-SHA256 hex digest under a key derived from the auth secret. **Never an address** |
| `window_start` | `timestamptz`, PK part, index | The start of the fixed window, from the injected `Clock` — no SQL default, so a test can move time                                                                                                                                                                                                                                                                                                                                                          |
| `count`        | `integer`, `CHECK (> 0)`      | Submissions in this bucket and window, including the latest                                                                                                                                                                                                                                                                                                                                                                                                 |

**The increment is one statement**: `INSERT … VALUES (…, 1), (…, 1) ON CONFLICT (bucket, window_start) DO UPDATE SET count = claim_rate_limit.count + 1 RETURNING …`. Postgres locks the conflicting row before evaluating the update, so concurrent submissions to one bucket each count once — asserted against a real Postgres with two dozen submissions racing on their own connections. Every submission locks its client bucket before its email bucket, so two submissions cannot deadlock each other.

**No foreign key and no Account.** The counter is about submissions, and a submission naming an address counts whether or not the address is registered; that is what keeps the limit from answering "is this address registered".

**Rows are forgotten** once their window has ended: the same call that counts deletes every window that started before `RATE_LIMIT_RETENTION_MS` (an hour), on the `window_start` index. The table holds an hour of hashed history, not a log.

**The table is shared** ([#158](https://github.com/joshstothard/3moji/issues/158)). The resend action's per-client-address limit counts here too, under a third bucket kind, `resend-client:`, with the same keyed hash and the same one-statement increment; see [auth.md](auth.md#resend-and-its-limits). One submission records one `resend-client` bucket, so it takes a single row lock and cannot deadlock with a Claim. Because every limiter's call prunes the whole table, **each prunes by the shared retention, never by its own window**, and every window must fit inside it — a limiter pruning by a shorter window would delete another's live counter, and that limit would fail open. The sign-in form (`sign-in-client:`), the password reset request form (`reset-request-client:`) and the header search (`search-client:`, a ten-minute window, [#254](https://github.com/joshstothard/3moji/issues/254)) count here the same way, one bucket each.

## Auth rate limit

**Built** — `authRateLimit` in `packages/core/src/db/schema.ts`, migration `0007_auth_rate_limit`; its keys are hashed since `0008_hash_auth_rate_limit_keys`, which deleted every row written before ([#214](https://github.com/joshstothard/3moji/issues/214)).

Better Auth's own rate-limit counters, one row per client address and path ([#158](https://github.com/joshstothard/3moji/issues/158)). **Better Auth owns the table and its shape** — it is what `getAuthTables` describes with `rateLimit.storage: "database"`, under the model name `auth_rate_limit` that `createAuth` chooses, and `schema.test.ts` asserts ours against it. The rule is in [auth.md](auth.md#better-auths-rate-limit).

| Column         | Type            | Why                                                                                                                                                                          |
| -------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | `text`, PK      | Not in Better Auth's field list, but required: its Drizzle adapter's atomic `incrementOne` updates by id, and answers "no row" when there is no id column                    |
| `key`          | `text`, unique  | HMAC-SHA256, hex, of Better Auth's `<client address>\|<path>` under a key derived from the auth secret. **Never the address**: `hashedRateLimitKeys` hashes it on the way in |
| `count`        | `integer`       | Requests since the counter last reset                                                                                                                                        |
| `last_request` | `bigint`, index | Epoch **milliseconds**, which overflows `integer`. Better Auth prunes rows older than its longest window on it                                                               |

**The increment is Better Auth's**: read the row, then `incrementOne` with a guard (`count < max` and `last_request` inside the window) in one `UPDATE … WHERE id IN (SELECT … LIMIT 1) RETURNING`, retrying on a lost race — so concurrent requests cannot both slip under the limit. A new key is created with a unique-violation retry.

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

**The tables are built, and the write path is built on them** ([#106](https://github.com/joshstothard/3moji/issues/106)). `packages/core/src/db/profile.ts` and `link.ts`, migration `0005_profile_and_link.sql`; no schema change was needed to start writing.

- **A Profile is keyed on the Account, not on the Handle.** `profile.user_id` is both the primary key and a foreign key to `user`, cascading on delete. Because Release _is_ account deletion ([ADR-0004](../adr/0004-the-handle-model.md) decision 5), deleting the `user` row takes the Profile with it, and the Profile's Links with that — `link.user_id` references `profile.user_id`, so the cascade is two hops and a Link without a Profile is unrepresentable. Account and Handle are one-to-one (decision 4), so "one Profile per Account" and "one Profile per Handle" are the same statement; the primary key is the cheaper half to enforce.
- **"At most ten Links" is structural.** `UNIQUE (user_id, position)` plus `CHECK (position >= 0 AND position < 10)` leaves nowhere for an eleventh row — no trigger, no `COUNT(*)` in a transaction, and no race between two concurrent writes. Raising the limit regenerates cleanly; lowering it would fail the migration against anyone already at the old limit.
- **Order is a column, and it is the only order a read may use.** Neither insertion order nor the primary key survives a reorder, and Postgres promises nothing without an `ORDER BY`.
- **A reorder rewrites the list, it does not renumber rows** ([#107](https://github.com/joshstothard/3moji/issues/107)). The owner rearranges the list in the form and the existing save writes it whole, inside one transaction: `DELETE` every Link of that Profile, then insert the new list with `position` as the array index. Updating positions in place is what `UNIQUE (user_id, position)` forbids — two Links swapping places collide with each other mid-statement — and for a list of at most ten rows inside a transaction, rewriting is cheaper than an ordering dance to avoid the collision. Re-inserting changes each Link's `id`, which is sound only because nothing references a Link. The rearranging rule itself is `moveLink` (`packages/core/src/profile/reorder-links.ts`): pure, and knowing nothing about the limit, since a move cannot change how long the list is.
- **The 30/160/40-character limits and the `http`/`https` rule are the write path's**, not the schema's. They are numbers that may move, and a `CHECK` on one is a hand-written migration waiting to happen.

**The read path is built.** `ProfileRepository.profileOf(key)` (`packages/core/src/ports/profile-repository.ts`), implemented by `createDrizzleProfileRepository` and constructed only by the composition root, answers a canonical `HandleKey` in **one** query — `handle → profile` inner join, `link` left join, ordered by `position`.

It returns `undefined` when the Account has no Profile row, and it deliberately **does not say whether the Handle is claimed**: deciding that needs an injected `now` and the hold-expiry rule, which live in `ownershipOf`, and a second encoding of that rule inside the join is what `src/db/handle.ts` warns against. The two are composed by the pure `profileStateOf(ownership, profile)` (`src/profile/profile-state.ts`), which is what makes **"claimed but unedited" a state a caller can see** — a named case, not a Profile whose fields all happen to be null. Ownership decides first, so a Profile row that outlives its Claim (a lazily-expired hold still has its rows sitting there) is never published.

**The limits are built** — `validateProfile` in `packages/core/src/profile/validate-profile.ts`, exported from the package entry point. It is pure: no database, no clock, no I/O, so it is the same answer wherever it is called from. The table above is the only place the numbers are stated in prose; the module states them once as `DISPLAY_NAME_MAX_LENGTH`, `BIO_MAX_LENGTH`, `LINK_LIMIT` and `LINK_TITLE_MAX_LENGTH`. It is reached on the write path by `editProfile`, and the form restates none of its numbers: a rejection carries the limit it broke, and the form renders that.

**It counts code points, not UTF-16 units.** `"🧊".length` is 2, so `String.length` charges an owner two characters for one emoji and calls a 30-emoji display name 60. A product about emoji cannot count that way, and the database will not either — `char_length` counts code points, as the `handle.key` CHECK already relies on. `Array.from(value).length` is the count, the same way `canonicalise` and `reserved-handles.ts` do it, and a test pins it with U+1F9CA. Grapheme clusters are **not** the unit: a flag or a ZWJ sequence costs more than one, which matches what the storage layer will count.

**The URL rule is a security control, not a format check**, because a Profile renders owner-supplied URLs to visitors. It is an **allowlist on the parsed `URL.protocol`** — `http:` and `https:` — never a prefix test on the raw string: the WHATWG parser lower-cases a scheme and strips leading whitespace and embedded tabs from it, so `JavaScript:`, `" javascript:"` and `"java\tscript:"` all reach a browser as working script URLs, and a **denylist** testing the raw string misses the last two entirely. An allowlist is what closes the other direction: `startsWith("http")` admits `httpfoo://evil.example` and `https-evil:alert(1)`, whose parsed protocols are `httpfoo:` and `https-evil:`. Measured against Node's WHATWG `URL`, not reasoned from memory. Tests pin those three shapes alongside plain `javascript:` and `data:`.

**A rejection is a result naming the field and the rule, not a boolean and not a throw** — the argument `canonicalise` makes, for the same reason: an edit that breaks a limit is an ordinary answer, and a form has to say what to fix. `ProfileViolation` is a discriminated union over `field` and `rule`, carrying the offending length or count and, for a Link, its index. It departs from `canonicalise`'s leftmost-offender rule in one way, deliberately: it reports **every** violation, because a form that reveals one problem per submission is a form nobody finishes. The determinism that rule exists to give is kept by fixing the order instead — display name, bio, link count, then per-Link ascending with title before URL — so the list is a function of the input alone.

**Nothing is normalised before counting.** The value is counted as given, so `é` written as U+00E9 costs one character and the same letter written as `e` + U+0301 costs two. The limits above are silent on this and NFC is not free of consequence — `canonicalise` applies it to a Handle because the `UNIQUE` index depends on it, where a display name has no index and no equality rule to protect. Revisit it if a Profile ever gains a uniqueness constraint.

A visitor sees one of three states: the Profile itself; a claimed but unedited Handle, shown large with its Spoken Name; or a held Handle, which reveals neither who holds it nor when the hold expires. An **unclaimed** Handle is not a 404: it renders the home-page builder pre-filled with those three emoji and a call to claim it.

**The write path is built** ([#106](https://github.com/joshstothard/3moji/issues/106)). `ProfileStore` (`packages/core/src/ports/profile-store.ts`) is a **unit of work**, not a pair of write methods on the read port — the same shape `ClaimStore` and `ReleaseStore` take, and the reason `ProfileRepository` stays read-only: the writes exist only on the object the transaction hands its callback, so nothing can rewrite a Link list without a transaction. `createDrizzleProfileStore` implements it and the composition root is the only thing that constructs it.

**One edit writes the whole Profile**, never a patch: the row is upserted, then the Link list is deleted and re-inserted entire. That is not laziness about efficiency — `UNIQUE (user_id, position)` makes an in-place rewrite collide with itself the moment two Links swap places, and the list is at most ten rows inside one transaction. It does mean a Link's `id` changes when its Profile is saved, which is sound only because nothing references a Link; `link.id` exists so that a _position_ need not be a key.

**`position` is the array index, dense from zero**, which is what keeps every row inside `link_position_within_limit`. The mapping is a pure function (`linkRowsFor`) rather than something buried in the statement, because this project has no local Postgres and a mapping only provable against one is a mapping nobody exercises on every run. An eleventh Link is not trimmed away by the transport: it reaches `validateProfile`, which says `too-many`, because a Link that silently vanished is worse than a refusal that names the rule.

**`updated_at` comes from the injected `Clock`**, never `now()` in SQL — the rule `src/db/profile.ts` states, honoured by passing the value down from the use case.

**A blank field is stored as `NULL`, not as `""`.** `NULL` is the column's "never set" and the page renders a display name only when it is not null, so an empty string would publish an empty heading where a `NULL` publishes none. `editProfile` collapses a wholly blank value, and that is a **storage mapping, not a limit**: `validateProfile` sets maxima only, so a blank display name is still permitted. **Whether a minimum should exist at all is an open question for the repository owner** ([#103](https://github.com/joshstothard/3moji/issues/103) implemented maxima only and specified none); the collapse above is the MVP's answer to what a blank field means in storage, not a decision that blanks are acceptable forever. One consequence worth knowing: an owner who saves an entirely empty form creates a `profile` row, which moves the Handle from the named `unedited` state to a `profile` state with nothing in it.

**A fourth arrival exists, and it is the word alias's** ([ADR-0008](../adr/0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md), [#109](https://github.com/joshstothard/3moji/issues/109)). An alias that matches more than one claimed Handle renders a **listing**, one row per match, each showing the Handle's emoji and the owner's display name — which is what the 30-character display name above disambiguates with. Around one alias in ten needs it. Unclaimed and Reserved Handles are omitted: a row exists because a Profile exists. **No unique username is introduced**; a second unique namespace would recreate the scarcity the emoji Handle exists to replace.

The display names behind a listing arrive on their own read — `ProfileRepository.displayNamesOf`, one query for the whole page — and **not** through the Profile read above. It joins `handle` to `profile` and stops there: the bio and the Link list a listing never shows would be up to eleven rows per Handle, against ADR-0008's worst measured alias of 64 candidates. A Handle with no `profile` row and one whose `display_name` is `null` are the same answer to it — absent — so a row is emoji, or emoji and a name, and never emoji and a blank.

**Built, as an honest answer rather than a Profile.** The route that resolves a Handle exists (see Routing in [system-overview.md](system-overview.md)) and tells the truth about which state it is in: the Handle's emoji, its Spoken Name as the accessible name, and then one of two things. Taken, on hold, reserved and "we could not check this Handle just now" are **one line**. **Unclaimed is the builder**, pre-filled with those three emoji and inviting the claim — the same `HandleBuilder` the home page renders, given the emoji from the path as `initialEmoji` rather than forked ([#105](https://github.com/joshstothard/3moji/issues/105)). Changing a slot from there behaves exactly as it does on `/`, live availability line and all, because it _is_ that component.

**The Profile itself is built** ([#104](https://github.com/joshstothard/3moji/issues/104)). A claimed Handle no longer stops at "This Handle is taken.": `apps/web/src/lib/profile.ts` composes the availability answer with `ProfileRepository.profileOf` through the pure `profileStateOf`, and the route renders the three cases that composition names.

- **`profile`** — the emoji as the `<h1>`, how to say it, the display name as an `<h2>` beneath it, the bio, then the Links **in `position` order**. The emoji stay the first-level heading: the display name belongs to the owner, but the Handle is what the page is about and what a screen reader announces first, as its Spoken Name. `displayName` and `bio` are `null` for "never set", so each is **omitted** rather than rendered as an empty field, and so is the spoken line when `spokenHandle` has no answer.
- **`unedited`** — the Handle large with its Spoken Name and one line saying nothing has been added. A **named state**, which is the whole reason `profileStateOf` exists: never an empty name, an empty bio and an empty Link list standing open.
- **`none`** — the "This Handle is taken." line, unchanged. It is also where a **failed** Profile read lands, deliberately: `unedited` is a statement about the owner, and a refused connection says nothing about the owner.

**A Profile is read for a claimed Handle and for nothing else, and that is three independent layers deep.** `readProfile` issues no query unless the availability answer is `claimed`; `profileStateOf` refuses to compose a Profile onto any other ownership verdict; and the route's own branch is nested under `claimed`, so a component handed a Profile for a held Handle still renders the held line. A Profile is the first thing this page shows that is **not** a state name — which is what makes it the first thing that could put a holder's name or a hold's expiry on a held Handle's page — so the route's suite forces the hostile case rather than merely omitting to supply one.

**Links are owner-supplied URLs rendered to strangers**, so the page carries `rel="noopener noreferrer"` on every one and **re-applies the `http`/`https` allowlist at the render** (`apps/web/src/lib/safe-link.ts`). That is the write path's rule stated a second time on purpose rather than imported from `ALLOWED_LINK_SCHEMES`: defence in depth only buys anything when the layers fail independently, and a row can predate the guard, arrive from a fixture, or be written by a path that forgets. A refused URL keeps its title — the owner's content, escaped by React — as **text with no `href` at all**, never a link to nowhere. The scheme is read off the parsed `URL.protocol` and the rendered `href` is the parser's own serialisation, so a leading space or an embedded tab cannot survive into the attribute as something the browser re-reads differently.

**The builder is the answer to "available" and to nothing else.** Reserved must not render it — offering to claim what nobody may ever own would be [#68](https://github.com/joshstothard/3moji/issues/68) in a new form — and neither must `unknown`, which means the read failed and so cannot know the Handle is free. That is held in the types rather than in care: "This Handle is available." has left the route's own namespace, so the four stated answers are a `Record` over a union with `available` excluded, and the builder branch is the only place the wording exists.

**A Reserved Handle resolves.** `/🍕🍕🍕` (platform-owned) and `/🔪🔪🔪` (a blocked emoji) each render "This Handle is reserved." — a real, well-formed Handle that nobody may own, so 404 would be a lie of the opposite kind to the one [#68](https://github.com/joshstothard/3moji/issues/68) reported. The message is the **same for both kinds and names no reason**: naming the block would be a hint to go looking for the list. **The held line names neither the holder nor the expiry**, per ADR-0004.

Neither omission is a matter of restraint in the JSX. The read answers with a **state name** — `AvailabilityState` is `HandleAvailability["state"] | "unknown"`, a string union — so the `Reservation` that carries the reason, and any hold expiry, never leave `packages/core`. Widening either would mean changing that type, with a test in `handle-availability.test.ts` turning red on the way.

**The route reads the database, and degrades to the pure domain when it cannot.** `lib/availability.ts` is the one read, shared with the builder's server action. It needs `lib/services.ts`, which throws unless all five environment variables are set, so every failure falls back to `claimableHandle` — pure, no I/O — which still answers _reserved_ and _not a Handle_ with certainty. Only available, held and claimed are indistinguishable without the `handle` table, and those become "unknown". Guessing "available" there is the #68 defect itself. The 404 and 308 branches run **before** the read and are unchanged.

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

`searchEmoji` matches a case-insensitive substring against **four** fields — `displayName`, `spokenName`, `plural` and `synonyms` — because each answers a different question: what the product shows, what Unicode calls it, what someone after two of something types, and the words the curation pass added precisely because none of the others would have been searched for. The plural has to be matched explicitly: substring matching cannot reach it from the singular, so "aubergines" found nothing until it was. A blank query matches nothing rather than everything, so an empty search box is not a request for all 307. The emoji picker no longer calls it ([#253](https://github.com/joshstothard/3moji/issues/253) removed the picker's search); it stays for the header search ([#254](https://github.com/joshstothard/3moji/issues/254)).

`findEmojiByCodepoint` is keyed on the code point itself — the single-character string that splitting a canonicalised Handle path yields. The `U+XXXX` notation is carried as a field for provenance and is not a lookup key. The lookup returns unreleased entries too, so a caller can tell "not an emoji we know" from "not claimable yet"; `isClaimableEmoji` is what decides a Claim.

| Field         | Source                            | Purpose                                                    |
| ------------- | --------------------------------- | ---------------------------------------------------------- |
| `spokenName`  | CLDR short name, immutable        | Canonical identity                                         |
| `displayName` | curated, defaults to `spokenName` | What the product says and shows                            |
| `synonyms`    | curated, may be empty             | Search only                                                |
| `plural`      | curated, stored                   | The collapsed spoken form, "three ice cubes"; searched too |
| `article`     | curated, defaults to a vowel rule | "an ice cube", not "a ice cube"                            |
| `group`       | Unicode                           | Theme, used for swap suggestions                           |

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
