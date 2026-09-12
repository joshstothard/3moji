# ADR-0009: Release leaves a tombstone and the cooldown is dropped for the MVP

**Status:** Accepted
**Date:** 2026-09-12

## Context

[ADR-0004](./0004-the-handle-model.md) decision 5 contradicts itself in a single sentence, and the contradiction only became visible while building the `handle` table ([#51](https://github.com/joshstothard/3moji/issues/51), filed as [#63](https://github.com/joshstothard/3moji/issues/63)):

> **Release is account deletion.** […] Releasing takes the Profile and its Links with it […] **A released Handle returns to the pool after 30 days.**

Both cannot hold. `handle.user_id` is a foreign key to Better Auth's `user` row with `ON DELETE CASCADE`, so deleting the Account takes the Handle row with it. **Nothing then records that the Handle was ever released, or when** — there is no row to date a cooldown from, and no way to distinguish "never claimed" from "released three days ago".

So the shipped behaviour today is already that **a released Handle returns to the pool immediately**. The ADR states a rule the schema cannot express. #51 deliberately left the gap visible rather than inventing a table with nothing writing to it, and recorded it in the schema comment and in `docs/architecture/data-model.md`.

**What the cooldown was for.** It stops churn-squatting: claim, release, reclaim, to deny someone else a Handle. At launch that attack requires deleting your entire Account — Profile and Links with it — on every cycle, which is a thin threat against a product with no users yet. ADR-0004's own Consequences already list "the flat 30-day cooldown" among four simplifications it calls "deliberate and revisitable".

**Time cannot be backfilled.** Whichever way the cooldown goes, a decision not to record release events is irreversible in one direction only: a cooldown switched on in six months with no history behind it starts from zero and cannot answer a single question about what happened before. That asymmetry, rather than the strength of the squatting threat, is what shapes the decision below.

**Deletion has to stay deletion.** Whatever survives an Account's deletion must not identify the person who held the Handle. A row that pairs a Handle with its former owner would make "Release takes the Profile and its Links with it" false in substance while true in letter.

## Options considered

| Option                                                         | Pros                                                                                                                                                                      | Cons                                                                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Tombstone, and enforce the 30-day cooldown                     | Honours ADR-0004 decision 5 as written                                                                                                                                    | Builds and tests enforcement, a sweep rule, and the "why can't I claim this?" copy, all against a threat with no users behind it yet     |
| Drop the cooldown, record nothing                              | Simplest; nothing to build                                                                                                                                                | Throws away history that cannot be recovered. Switching the cooldown on later starts blind                                               |
| Stop cascading: keep the row, null the owner, date the release | One table, no new writer                                                                                                                                                  | Contradicts decision 4's invariant that every live Account owns exactly one Handle, and leaves orphan rows every query must reason about |
| Make Release not delete the Account                            | Fits a cooldown naturally                                                                                                                                                 | Reopens the handle-less-Account question decisions 4 and 5 were written to close                                                         |
| **Tombstone written, cooldown not enforced (chosen)**          | Costs one narrow table and one write; keeps the history that cannot be retrofitted; leaves the claim path untouched; enabling the cooldown later is a new ADR plus a read | A table that is written and never read until then — a real smell, confronted in Consequences                                             |

## Decision

1. **The cooldown is dropped for the MVP.** A released Handle returns to the pool immediately and is claimable by anyone, including its previous owner. This supersedes ADR-0004 decision 5's final clause, "A released Handle returns to the pool after 30 days"; the rest of decision 5 — that Release is account deletion, that it takes the Profile and Links with it, and that the interface must say so plainly — stands unchanged.

2. **Release writes a tombstone.** A `released_handle` table records the canonical key and the release timestamp, written in the same transaction that deletes the Account.

3. **The tombstone holds the canonical key and the timestamp, and nothing else.** No `user_id`, no email, no Profile field, no foreign key to any Account. Account deletion must remain deletion, and a tombstone that identified its former owner would quietly break that promise. The canonical key is a public URL that was already visible to anyone, so on its own it identifies nobody.

4. **The write is in the delete use case, not a database trigger.** `drizzle-kit generate` owns this schema, and a trigger is hand-written SQL outside it — the same trade already taken for the Reserved Handle constraint. The accepted cost is that the database cannot enforce it: a deletion that bypasses the use case, such as a direct `DELETE` on the `user` row, leaves no tombstone. The tombstone is evidence, not an invariant, and it is not load-bearing for correctness while the cooldown is off.

5. **The claim path does not read the tombstone.** "No cooldown" is therefore structural rather than asserted — there is no branch to get wrong, and no way for a stale tombstone to block a legitimate claim.

6. **Tombstones are not swept in the MVP.** A row is a key and a timestamp; there is no retention rule to get right yet, and sweeping is what would destroy the history the table exists to keep.

7. **Turning the cooldown on is a new ADR.** It needs a decision on the period, a read in the claim gate, the copy for a refused claim, and a retention rule — and by then the tombstone will hold real data to choose the period from.

## Consequences

- **Churn-squatting is free at launch, and this is a deliberate acceptance, not an oversight.** Someone willing to delete their Account each cycle can claim, release and reclaim a Handle to deny it to someone else. The mitigation is that the attack destroys the attacker's own Profile and Links every time, and that the tombstone makes the pattern visible after the fact.
- **We are building a table that is written and never read, having refused to build one that was read and never written.** That deserves stating rather than glossing: #51 declined a tombstone with nothing writing to it, and this ADR mandates a tombstone with nothing reading it. The asymmetry is the argument — a table with a writer and no reader accumulates something that cannot be recreated later, while a table with a reader and no writer answers nothing. If that argument is wrong, this is the decision to revisit first.
- **`CONTEXT.md` § Release becomes false and is corrected in the same PR.** It currently reads "which returns to the pool after a cooldown"; there is no cooldown.
- **`docs/architecture/data-model.md` loses its "Open: the 30-day cooldown has nowhere to live" entry**, because it is no longer open, and its Handle lifecycle line stops promising 30 days.
- **A migration is required when this is built** (Absolute Rule 4: schema and migration travel together). Nothing is built in this PR — the architecture docs mark the table **planned, not yet built** — so no migration belongs here.
- **The chosen behaviour must be asserted, not assumed.** Per [#63](https://github.com/joshstothard/3moji/issues/63), Phase 3 needs an integration test against real Postgres proving a just-released Handle **can** be claimed immediately. "No cooldown" is easy to satisfy by accident, so the test exists to make it deliberate.
- **Phase 3 is unblocked**, which was the point: Release can now be built, and [#63](https://github.com/joshstothard/3moji/issues/63) closes with the ADR that resolves it.
- **One privacy rule now outlives this ADR:** if anyone ever adds a user reference to `released_handle`, account deletion stops being deletion. That constraint belongs in the table's own comment, not only here.

## Related

- Workstream: [3moji MVP](../workstreams/3moji-mvp.md)
- Issues: [#63](https://github.com/joshstothard/3moji/issues/63), [#51](https://github.com/joshstothard/3moji/issues/51)
- Supersedes: [ADR-0004: The Handle model](./0004-the-handle-model.md) — decision 5's cooldown clause only
- Architecture: [data-model.md](../architecture/data-model.md)
