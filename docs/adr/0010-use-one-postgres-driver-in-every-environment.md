# ADR-0010: Use one Postgres driver in every environment

**Status:** Accepted
**Date:** 2026-09-12

## Context

[ADR-0004](./0004-the-handle-model.md) decision 4 makes Account creation and the Handle's hold **one atomic act** — neither exists without the other. Four issues now rest on that being a real transaction: the Claim (#81), its finalisation on verification (#82), lazy hold expiry freeing a row inside the claim transaction (#83), and Release writing a tombstone (#84, not yet built).

**The driver chosen for production cannot open one.** `drizzle-orm/neon-http/session.js` throws `No transactions support in neon-http driver`, and Neon's own driver documentation states the HTTP `neon()` function supports only non-interactive batched transactions via `transaction()`, not interactive ones ([the hosting report](../reports/2026-09-11-hosting-and-email.md), finding 2). [ADR-0006](./0006-nextjs-on-vercel-is-the-whole-application.md) decision 6 selects exactly that driver: "Neon Postgres via the Vercel Marketplace, **using the serverless HTTP driver**".

**Nothing caught it, and the reason matters more than the bug.** `packages/core/src/db/driver.ts` resolves `neon-http` when `NODE_ENV === "production"` and `node-postgres` otherwise. Local development and CI therefore exercise a _different driver from production_, so four pull requests merged with full green CI while the code path that matters most could not run on the deployed site. The one environment with no test coverage was the only one that diverged. This is the same shape as every other defect found in this project: the gap between local and deployed resolution.

The Vercel-managed Neon integration injects both `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct), so either connection is available without new configuration.

Filed as [#89](https://github.com/joshstothard/3moji/issues/89).

## Options considered

| Option                                                                             | Pros                                                                                                                                  | Cons                                                                                                                                                                      |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `neon-serverless` (WebSockets) in production                                       | Supports interactive transactions; same provider; the migration path the hosting report anticipated                                   | **Keeps two drivers**, so the local-versus-production divergence that hid this bug survives intact; needs `ws` and `bufferutil` in Node                                   |
| **`node-postgres` in every environment, pooled connection in production (chosen)** | One driver everywhere, so CI exercises exactly what production runs; removes a dependency and a code path; not tied to Neon or Vercel | A TCP and TLS handshake per cold start rather than HTTP; unverified on Vercel's runtime; not the driver Neon presents as the serverless default                           |
| Keep `neon-http`, drop atomicity                                                   | Nothing to change                                                                                                                     | Contradicts ADR-0004 decision 4, and "every live Account owns exactly one Handle" is the invariant the product rests on                                                   |
| Keep `neon-http`, emulate atomicity in application code                            | Keeps the HTTP driver's cold-start advantage                                                                                          | A compensating-write scheme that must be correct under a crash between writes. More ways to be subtly wrong than the other options, and no test can easily prove it right |

## Decision

1. **One Postgres driver in every environment: `node-postgres` over TCP.** This supersedes ADR-0006 decision 6's clause "using the serverless HTTP driver", and that clause only.
2. **Production connects on the pooled `DATABASE_URL`.** Migrations keep running against the **unpooled** connection from committed files in the build step, unchanged from decision 6.
3. **`resolveDriver` stops branching on `NODE_ENV`.** A driver that depends on the environment is the mechanism that hid this defect, so the branch goes rather than being corrected.
4. **`@neondatabase/serverless` and the `neon-http` code path are removed**, so a driver that cannot open a transaction is not merely unselected but unavailable.
5. **A test asserts the configured driver can open an interactive transaction.** A unit test over `resolveDriver` is not enough: the gap was never in the choice, it was in the chosen driver's _capability_, and nothing asserted that capability anywhere.
6. **This is unverified on Vercel and must not be presumed.** [#32](https://github.com/joshstothard/3moji/issues/32) must confirm a transaction commits on a deployed preview before launch. If `node-postgres` proves unworkable on that runtime, `neon-serverless` is the fallback and needs its own ADR rather than a quiet swap.
7. **The rest of ADR-0006 decision 6 stands**: Neon Postgres via the Vercel Marketplace, `drizzle-kit migrate` from committed migration files in the build step, a database branch per preview deployment, and no schema change ever applied by hand.

## Consequences

- **CI begins exercising the production driver**, which removes the class of defect this ADR exists to fix rather than this one instance of it. That is the whole value of the decision; the transaction support is almost incidental.
- **ADR-0006 decision 8's reversibility conditions get easier, not harder.** One of the five is that no Vercel-only primitive appears in `packages/core`. `node-postgres` is neither Vercel- nor Neon-specific, so the domain becomes more portable than decision 6 left it.
- **A TCP and TLS handshake per cold start replaces an HTTP request.** Neon's HTTP driver exists precisely to avoid that. At launch volume, against a database the hosting report measures as resuming from idle in under a second, this is accepted — but it is a real cost and the first thing to measure if cold starts disappoint.
- **Neon's pooled endpoint is PgBouncer in transaction mode, so an interactive transaction pins a server connection for its duration.** Acceptable at launch volume and worth watching as traffic grows.
- **Two things are flagged as needing verification rather than asserted**, because neither has been measured: `node-postgres` behaviour on Vercel's serverless runtime, and whether transaction-mode pooling's lack of prepared-statement support affects Drizzle's `node-postgres` path. Decision 6 above is where the first is owed; the second belongs with it.
- **#84 is unblocked**, and with it Phase 3's stated outcome — claiming a Handle end to end on the live site.
- **[#89](https://github.com/joshstothard/3moji/issues/89) does not close with this ADR.** The decision is made; the code change, the removal of the dependency, and the capability test are owed. Closing it here would mark work done that nobody has written.
- Current-state impact: `docs/architecture/system-overview.md` and `docs/architecture/data-model.md` are updated alongside this ADR, marked planned rather than built.

## Related

- Report: [Hosting and email on free tiers](../reports/2026-09-11-hosting-and-email.md)
- Workstream: [3moji MVP](../workstreams/3moji-mvp.md)
- Issues: [#89](https://github.com/joshstothard/3moji/issues/89), [#32](https://github.com/joshstothard/3moji/issues/32), [#84](https://github.com/joshstothard/3moji/issues/84)
- Supersedes: [ADR-0006: Next.js on Vercel is the whole application](./0006-nextjs-on-vercel-is-the-whole-application.md) — decision 6's driver clause only
- Architecture: [system-overview.md](../architecture/system-overview.md), [data-model.md](../architecture/data-model.md)
