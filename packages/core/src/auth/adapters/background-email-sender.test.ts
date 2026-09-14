import { createHeldBackgroundTasks } from "../../adapters/held-background-tasks";
import type { EmailSender, OutboundEmail } from "../ports/email-sender";
import {
  createBackgroundEmailSender,
  DEFERRED_EMAIL_FAILURE_EVENTS,
} from "./background-email-sender";
import { createRecordingEmailSender } from "./recording-email-sender";

const EMAIL: OutboundEmail = {
  to: "owner@example.com",
  subject: "Reset your 3moji password",
  text: "Reset your password: https://3moji.me/reset-password/token",
  html: '<a href="https://3moji.me/reset-password/token">Reset your password</a>',
};

const STILL_WAITING = "still waiting on the provider";

/** Whether `promise` settles before a macrotask runs — before any I/O could. */
const answeredOrWaiting = (promise: Promise<void>): Promise<string> =>
  Promise.race([
    promise.then(() => "answered"),
    new Promise<string>((resolve) => {
      setImmediate(() => {
        resolve(STILL_WAITING);
      });
    }),
  ]);

describe("createBackgroundEmailSender (#216)", () => {
  it("answers before the provider does", async () => {
    const provider: EmailSender = {
      send: () => new Promise<void>(() => undefined),
    };
    const sender = createBackgroundEmailSender({
      inner: provider,
      tasks: createHeldBackgroundTasks(),
      event: DEFERRED_EMAIL_FAILURE_EVENTS.auth,
    });

    expect(await answeredOrWaiting(sender.send(EMAIL))).toBe("answered");
  });

  it("hands the provider nothing until the background task runs, then exactly the email it was given", async () => {
    const provider = createRecordingEmailSender();
    const tasks = createHeldBackgroundTasks();
    const sender = createBackgroundEmailSender({
      inner: provider,
      tasks,
      event: DEFERRED_EMAIL_FAILURE_EVENTS.auth,
    });

    await sender.send(EMAIL);
    expect(provider.sent).toHaveLength(0);
    expect(tasks.pending()).toBe(1);

    await tasks.release();
    expect(provider.sent).toEqual([EMAIL]);
  });

  it("does not reject when the provider throws, and the failure is reported once under its event", async () => {
    const failure = new Error("the provider is unavailable");
    const provider: EmailSender = { send: () => Promise.reject(failure) };
    const tasks = createHeldBackgroundTasks();
    const sender = createBackgroundEmailSender({
      inner: provider,
      tasks,
      event: DEFERRED_EMAIL_FAILURE_EVENTS.claimCollision,
    });

    await expect(sender.send(EMAIL)).resolves.toBeUndefined();
    expect(tasks.failures).toEqual([]);

    await tasks.release();
    expect(tasks.failures).toEqual([
      { event: "claim_collision_email_failed", error: failure },
    ]);
  });
});
