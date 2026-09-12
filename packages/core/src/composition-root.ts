import { createAuth, type CreateAuthInput } from "./auth/create-auth";
import { createDrizzleHandleRepository } from "./adapters/drizzle-handle-repository";
import type { Database } from "./db/client";
import type { Clock } from "./ports/clock";
import type { HandleRepository } from "./ports/handle-repository";

/**
 * Everything the domain needs from the outside world, supplied by the caller.
 */
export interface CoreDependencies {
  readonly clock: Clock;
  /**
   * The one Drizzle client for this process. Passed in rather than constructed
   * here, because the driver choice belongs to the deployment and
   * `createDatabase` needs a connection string this function has no business
   * reading.
   *
   * **It is a single field on purpose.** Better Auth's adapter and the Handle
   * repository must talk to the same database, and two fields that could hold
   * different clients would make that an accident waiting to happen rather
   * than an invariant — so `auth` takes everything *except* the client, and
   * this function supplies it to both.
   */
  readonly db: Database;
  readonly auth: Omit<CreateAuthInput, "db">;
}

/**
 * The wired domain surface that transport adapters call.
 */
export interface CoreServices {
  readonly clock: Clock;
  readonly auth: ReturnType<typeof createAuth>;
  readonly handles: HandleRepository;
}

/**
 * The manual composition root.
 *
 * ADR-0006 decision 4 replaces runtime dependency injection with this function,
 * because Next.js route handlers and server actions have no container to wire
 * them. Dependencies are passed in and collaborators are constructed here, so
 * the domain never reaches out for one and every test can substitute a fake.
 *
 * Nothing else in the codebase should construct the auth instance: there is one
 * place to look when you need to know what depends on what.
 */
export function createCoreServices(deps: CoreDependencies): CoreServices {
  return {
    clock: deps.clock,
    auth: createAuth({ ...deps.auth, db: deps.db }),
    handles: createDrizzleHandleRepository(deps.db),
  };
}
