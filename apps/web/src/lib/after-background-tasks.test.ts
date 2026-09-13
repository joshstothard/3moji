/**
 * @jest-environment node
 */

/**
 * Email sent after the response, through Next.js's `after()`
 * ([#216](https://github.com/joshstothard/3moji/issues/216)).
 *
 * `after()` itself is injected, so each test decides when a scheduled callback
 * runs — and runs it **outside** the request's store, as a callback may run
 * once the response has gone. That is what proves the correlation id is
 * captured when the task is scheduled rather than read when it fails.
 */
import "../test-support/next-async-local-storage";

import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";

const mockAfter = jest.fn();
jest.mock("next/server", () => ({
  after: (callback: unknown) => {
    mockAfter(callback);
  },
}));

import { createAfterBackgroundTasks } from "./after-background-tasks";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const EMAIL = "owner@example.com";
const TOKEN = "resettoken0123456789abcd";

/** Run `work` inside a store shaped like the one Next.js keeps for a request. */
function insideRequest(work: () => void): void {
  Reflect.apply(
    workUnitAsyncStorage.run.bind(workUnitAsyncStorage),
    undefined,
    [
      { type: "request", headers: new Headers({ "x-correlation-id": ID }) },
      work,
    ],
  );
}

/** `after()`, held: the callbacks it was handed, run when the test says. */
function heldAfter() {
  const callbacks: (() => Promise<void>)[] = [];
  return {
    callbacks,
    schedule: (callback: () => Promise<void>) => {
      callbacks.push(callback);
    },
  };
}

/** What a provider rejection can look like: its message quotes the address. */
function providerFailure(): Error {
  return Object.assign(
    new Error(
      `Resend refused ${EMAIL}: https://3moji.me/reset-password/${TOKEN}`,
    ),
    { name: "ResendRequestRejected", status: 503 },
  );
}

let written: string[] = [];

beforeEach(() => {
  written = [];
  for (const stream of ["log", "info", "warn", "error", "debug"] as const) {
    jest.spyOn(console, stream).mockImplementation((...args: unknown[]) => {
      written.push(args.map((arg) => String(arg)).join(" "));
    });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
  mockAfter.mockReset();
});

describe("createAfterBackgroundTasks (#216)", () => {
  it("uses Next.js's after() unless told otherwise", () => {
    createAfterBackgroundTasks().run("auth_email_send_failed", () =>
      Promise.resolve(),
    );

    expect(mockAfter).toHaveBeenCalledTimes(1);
  });

  it("hands the task to after() instead of running it in the request", async () => {
    const { callbacks, schedule } = heldAfter();
    const task = jest.fn(() => Promise.resolve());

    createAfterBackgroundTasks(schedule).run("auth_email_send_failed", task);

    expect(task).not.toHaveBeenCalled();
    expect(callbacks).toHaveLength(1);
    for (const callback of callbacks) await callback();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("logs a failed task once, with the id of the request that scheduled it and nothing from the error's message", async () => {
    const { callbacks, schedule } = heldAfter();
    const tasks = createAfterBackgroundTasks(schedule);

    insideRequest(() => {
      tasks.run("auth_email_send_failed", () =>
        Promise.reject(providerFailure()),
      );
    });
    // Outside the request's store, as a callback may run after the response.
    for (const callback of callbacks) await callback();

    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0] ?? "null")).toEqual({
      event: "auth_email_send_failed",
      correlationId: ID,
      error: { name: "ResendRequestRejected", status: "503" },
    });
    expect(written.join("\n")).not.toContain(EMAIL);
    expect(written.join("\n")).not.toContain(TOKEN);
  });

  it("never lets a failure reach after(), which would print the raw error", async () => {
    const { callbacks, schedule } = heldAfter();

    createAfterBackgroundTasks(schedule).run(
      "claim_collision_email_failed",
      () => Promise.reject(providerFailure()),
    );

    const [callback] = callbacks;
    if (callback === undefined) throw new Error("nothing was scheduled");
    await expect(callback()).resolves.toBeUndefined();
  });

  it("still runs the task, and logs its failure once, when after() refuses to schedule outside a request", async () => {
    const tasks = createAfterBackgroundTasks(() => {
      throw new Error("`after` was called outside a request scope.");
    });
    let ran = false;

    tasks.run("auth_email_send_failed", () => {
      ran = true;
      return Promise.reject(providerFailure());
    });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(ran).toBe(true);
    expect(written.map((line): unknown => JSON.parse(line))).toEqual([
      {
        event: "auth_email_send_failed",
        correlationId: "none",
        error: { name: "ResendRequestRejected", status: "503" },
      },
    ]);
  });
});
