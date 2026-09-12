import { createAuth, type CreateAuthInput } from "./auth/create-auth";
import type { Clock } from "./ports/clock";

/**
 * Everything the domain needs from the outside world, supplied by the caller.
 */
export interface CoreDependencies {
  readonly clock: Clock;
  readonly auth: CreateAuthInput;
}

/**
 * The wired domain surface that transport adapters call.
 */
export interface CoreServices {
  readonly clock: Clock;
  readonly auth: ReturnType<typeof createAuth>;
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
    auth: createAuth(deps.auth),
  };
}
