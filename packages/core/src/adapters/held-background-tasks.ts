import type { BackgroundTasks } from "../ports/background-tasks";

/** A task that failed when it was released, and the event it was run under. */
export interface HeldTaskFailure {
  readonly event: string;
  readonly error: unknown;
}

export interface HeldBackgroundTasks extends BackgroundTasks {
  /** How many tasks are waiting to run. */
  pending(): number;
  /** Every task that failed when released, oldest first. */
  readonly failures: readonly HeldTaskFailure[];
  /**
   * Runs everything held, in the order it was scheduled — a task scheduled
   * while releasing included — and resolves when the last has settled. A
   * failure is recorded in {@link failures}, never rethrown, as the real
   * implementation logs one rather than failing anything.
   */
  release(): Promise<void>;
}

/**
 * {@link BackgroundTasks} that holds every task until it is released.
 *
 * **For code that runs outside a request**: tests, which release it to prove
 * an answer came back before any email was sent, and the E2E seed, which
 * releases it before reading the link a recording sender captured
 * ([#216](https://github.com/joshstothard/3moji/issues/216)). Production wires
 * Next.js's `after()` in `apps/web` instead.
 */
export function createHeldBackgroundTasks(): HeldBackgroundTasks {
  const held: { readonly event: string; readonly task: () => Promise<void> }[] =
    [];
  const failures: HeldTaskFailure[] = [];

  return {
    failures,
    pending: () => held.length,
    run: (event, task) => {
      held.push({ event, task });
    },
    release: async () => {
      for (let next = held.shift(); next !== undefined; next = held.shift()) {
        try {
          await next.task();
        } catch (error) {
          failures.push({ event: next.event, error });
        }
      }
    },
  };
}
