import type { Clock } from "../ports/clock";

/** The real clock. Wired in production by the composition root. */
export function createSystemClock(): Clock {
  return {
    now: () => new Date(),
  };
}
