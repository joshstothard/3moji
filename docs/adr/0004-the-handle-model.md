# ADR-0004: The Handle model

**Status:** Accepted
**Date:** 2026-09-12

## Context

A Handle is the product. It is shown on screen, typed into an address bar, and said out loud. Three facts constrain how it is stored, established by [the emoji URL report](../reports/2026-09-11-emoji-urls.md):

- Browsers always percent-encode a non-ASCII path, and Next.js hands the dynamic segment to the page still encoded.
- Unicode normalisation alone cannot merge two spellings of the same emoji, because NFC does not remove the variation selector U+FE0F.
- A Postgres `UNIQUE` index is byte equality under a deterministic collation, so it only means what we intend if the application canonicalises before every write.

The vocabulary is fixed in [`CONTEXT.md`](../../CONTEXT.md).

## Decision

1. **Canonical key.** Decode the path once, apply NFC, strip U+FE0E and U+FE0F, split into code points, and require every one to be in the Emoji Set. The canonical key is that code-point sequence, stored with a `UNIQUE` index under a deterministic collation. Canonicalisation before every write is mandatory. A request whose path is not byte-identical to the encoded canonical form redirects permanently to it; one that cannot be canonicalised returns 404.
2. **Length.** Exactly three emoji are claimable at launch. Repetition is allowed, and all-same triples such as 🧊🧊🧊 are freely claimable, first come first served. One- and two-emoji Handles are Reserved.
3. **Hold.** Creating an Account holds its Handle for 24 hours pending email verification. Holds expire **lazily**, evaluated when someone next attempts to claim that Handle. There is no scheduled sweep.
4. **Invariant: every live Account owns exactly one Handle.** Account creation and the hold are one atomic act; neither exists without the other.
5. **Release is account deletion.** Because of decision 4 there is no handle-less state to release into. Releasing takes the Profile and its Links with it, and the interface must say so plainly rather than hiding it behind the word "release". A released Handle returns to the pool after 30 days. An unverified Account whose hold expires is deleted alongside it.
6. **No Handle change in the MVP.** Release and claim again reaches the same outcome with fewer states to build and test.
7. **Reserved Handles are enforced in three independent layers**: rejected by the domain layer before any write, re-checked inside the claim transaction, and finally guarded by the database constraint, which is what decides a race between simultaneous claims. Never middleware alone.

## Consequences

- Canonicalisation is the single riskiest function in the system: the uniqueness guarantee rests entirely on it. It needs property-based tests, not examples.
- Decision 2 is a one-way door. All-same triples can be reserved later, but ones already claimed cannot be recovered.
- Decision 5 makes account deletion a routine action rather than a rare one, which raises the bar on confirmation copy.
- Lazy expiry means a Handle can appear held after its hold has died, until someone tries to claim it. That is acceptable and invisible in practice.
- **Four MVP simplifications are deliberate and revisitable**, and improving them later is not a reversal of this ADR: lazy expiry rather than a scheduled sweep, the flat 30-day cooldown, release as account deletion, and the absence of Handle change.

## Related

- Report: [How emoji survive in URL paths](../reports/2026-09-11-emoji-urls.md)
- Workstream: [3moji MVP](../workstreams/3moji-mvp.md)
- Issues: #14, #15, #8
- Architecture: [data-model.md](../architecture/data-model.md)
