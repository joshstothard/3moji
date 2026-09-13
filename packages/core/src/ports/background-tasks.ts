/**
 * Runs work after the answer has gone back to the caller
 * ([#216](https://github.com/joshstothard/3moji/issues/216)).
 *
 * A port because "after the response" is a fact about the transport, not the
 * domain: `apps/web` implements it with Next.js's `after()`, a test with a fake
 * it releases by hand, and nothing in `packages/core` may import `next/*`.
 *
 * **`run` returns nothing and never throws.** The caller has already decided
 * its answer, and a task's outcome is not something it may wait on or branch
 * on — that is the point. `event` names the failure for the logs: an
 * implementation reports a failed task under it, once, and without the error's
 * message, which can quote an address.
 */
export interface BackgroundTasks {
  run(event: string, task: () => Promise<void>): void;
}
