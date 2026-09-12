import type { Clock } from "../ports/clock";

/**
 * The shortest an unauthenticated answer about an email address may take.
 *
 * **500 ms, which is Better Auth's own figure.** Its
 * `/send-verification-email` endpoint enforces a 500 ms floor for exactly this
 * reason, and `/request-password-reset` simulates work for unknown addresses
 * ([#15](https://github.com/joshstothard/3moji/issues/15)): a fast answer says
 * "nothing to do here" and a slow one says "an account exists", and that
 * difference is an enumeration oracle no matter what the response body says.
 *
 * Matching the library's number rather than picking our own keeps the two paths
 * indistinguishable from each other as well.
 */
export const RESPONSE_FLOOR_MS = 500;

export interface ResponseFloorInput {
  /** The one place time is read; the same `Clock` the use case already holds. */
  readonly clock: Clock;
  /** Injected so a test proves the floor without waiting for it. */
  readonly sleep: (ms: number) => Promise<void>;
  readonly floorMs?: number;
}

/** A real sleep. The default, and the only thing production should use. */
export const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Runs `work` and holds its answer back until the floor has passed.
 *
 * The branches this pads are the fast ones — a rate-limited resend returns
 * after two indexed reads, while a real send waits on an HTTP request to an
 * email provider. Padding the fast branch is the only direction that works: the
 * slow one cannot be made faster, and its duration already varies.
 *
 * It pads rather than fixing the total, because a fixed duration would have to
 * exceed the slowest branch to be honest, and a provider that took two seconds
 * would then make every answer take two seconds.
 *
 * `pads` says which answers are about an *address* and therefore have something
 * to conceal. An answer about a *Handle* does not: the builder already shows
 * availability live, so padding a "that Handle is taken" would slow the product
 * down to protect information it publishes. A thrown error is always padded,
 * because it has no value to ask about and an exception that came back faster
 * than a success would leak just as much.
 */
export async function withResponseFloor<T>(
  input: ResponseFloorInput,
  work: () => Promise<T>,
  pads: (value: T) => boolean = () => true,
): Promise<T> {
  const floorMs = input.floorMs ?? RESPONSE_FLOOR_MS;
  const started = input.clock.now().getTime();

  const hold = async (): Promise<void> => {
    const remaining = floorMs - (input.clock.now().getTime() - started);
    if (remaining > 0) {
      await input.sleep(remaining);
    }
  };

  let value: T;
  try {
    value = await work();
  } catch (error) {
    await hold();
    throw error;
  }

  if (pads(value)) {
    await hold();
  }
  return value;
}
