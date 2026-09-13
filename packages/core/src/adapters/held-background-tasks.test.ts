import { createHeldBackgroundTasks } from "./held-background-tasks";

describe("createHeldBackgroundTasks", () => {
  it("runs nothing until it is released", async () => {
    const tasks = createHeldBackgroundTasks();
    const ran: string[] = [];

    tasks.run("first_failed", () => {
      ran.push("first");
      return Promise.resolve();
    });

    expect(ran).toEqual([]);
    expect(tasks.pending()).toBe(1);
    await tasks.release();
    expect(ran).toEqual(["first"]);
    expect(tasks.pending()).toBe(0);
  });

  it("runs tasks in order, including one scheduled while it releases", async () => {
    const tasks = createHeldBackgroundTasks();
    const ran: string[] = [];

    tasks.run("first_failed", () => {
      ran.push("first");
      tasks.run("third_failed", () => {
        ran.push("third");
        return Promise.resolve();
      });
      return Promise.resolve();
    });
    tasks.run("second_failed", () => {
      ran.push("second");
      return Promise.resolve();
    });
    await tasks.release();

    expect(ran).toEqual(["first", "second", "third"]);
  });

  it("records a failure under its event rather than rejecting, and keeps going", async () => {
    const tasks = createHeldBackgroundTasks();
    const failure = new Error("the provider is unavailable");
    const ran: string[] = [];

    tasks.run("first_failed", () => Promise.reject(failure));
    tasks.run("second_failed", () => {
      ran.push("second");
      return Promise.resolve();
    });

    await expect(tasks.release()).resolves.toBeUndefined();
    expect(tasks.failures).toEqual([{ event: "first_failed", error: failure }]);
    expect(ran).toEqual(["second"]);
  });
});
