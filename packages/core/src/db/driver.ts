/**
 * Which Drizzle driver to talk to Postgres through.
 *
 * **One driver in every environment** — `node-postgres` over TCP, locally, in
 * CI and in production ([ADR-0010](../../../../docs/adr/0010-use-one-postgres-driver-in-every-environment.md)).
 *
 * It used to depend on `NODE_ENV`: Neon's serverless HTTP driver in production,
 * `node-postgres` everywhere else. That driver has no interactive transactions
 * — it throws `No transactions support in neon-http driver` — so the Claim,
 * its finalisation and lazy hold expiry could not have run on the deployed
 * site. **Nothing caught it because CI exercised a different driver from
 * production**, and the one environment with no test coverage was the only one
 * that diverged. Four pull requests merged green over a path that could not
 * work.
 *
 * So the branch is gone rather than corrected. This function survives to keep
 * the decision in one named, tested place instead of dissolving into an
 * implicit default.
 */
export type DatabaseDriver = "node-postgres";

export interface ResolveDriverInput {
  /**
   * The value of `NODE_ENV`, passed in rather than read here — and now
   * deliberately ignored. The parameter stays so callers need not change and
   * so the tests can prove the environment no longer decides anything.
   */
  readonly nodeEnv: string | undefined;
}

/**
 * Nothing here reads `process.env`. The domain must not depend on ambient
 * state, so the caller supplies the environment and tests supply a fake one.
 */
export function resolveDriver(_input: ResolveDriverInput): DatabaseDriver {
  return "node-postgres";
}
