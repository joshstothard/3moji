import type { Clock } from "./ports/clock";

/**
 * Everything the domain needs from the outside world, supplied by the caller.
 */
export interface CoreDependencies {
  readonly clock: Clock;
}

/**
 * The wired domain surface that transport adapters call.
 */
export interface CoreServices {
  readonly clock: Clock;
}

/**
 * The manual composition root.
 *
 * ADR-0006 decision 4 replaces runtime dependency injection with this function,
 * because Next.js route handlers and server actions have no container to wire
 * them. Dependencies are passed in and use cases are constructed here, so the
 * domain never reaches out for a collaborator and every test can substitute one.
 *
 * Use cases are added to `CoreServices` as they arrive, each constructed here
 * from `deps`. Nothing else in the codebase should construct them.
 */
export function createCoreServices(deps: CoreDependencies): CoreServices {
  return {
    clock: deps.clock,
  };
}
