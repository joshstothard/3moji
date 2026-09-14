import type { EmailSender, OutboundEmail } from "../ports/email-sender";
import { createRecordingEmailSender } from "./recording-email-sender";
import { createDeferredEmailSender } from "./deferred-email-sender";

const email = (to: string): OutboundEmail => ({
  to,
  subject: "Verify your email to claim your 3moji handle",
  text: "Verify your email: https://3moji.me/verify?token=abc",
  html: '<a href="https://3moji.me/verify?token=abc">Verify your email</a>',
});

describe("createDeferredEmailSender", () => {
  it("sends nothing until it is flushed", async () => {
    const inner = createRecordingEmailSender();
    const deferred = createDeferredEmailSender(inner);

    await deferred.send(email("one@example.com"));

    expect(inner.sent).toHaveLength(0);
    expect(deferred.held).toHaveLength(1);
  });

  it("delivers what it held, in the order it was given", async () => {
    const inner = createRecordingEmailSender();
    const deferred = createDeferredEmailSender(inner);

    await deferred.send(email("one@example.com"));
    await deferred.send(email("two@example.com"));
    await deferred.flush();

    expect(inner.sent.map((sent) => sent.to)).toEqual([
      "one@example.com",
      "two@example.com",
    ]);
  });

  /**
   * The reason this adapter exists. A rolled-back Claim must not send "verify
   * your email to claim your handle" for an Account that no longer exists.
   */
  it("sends nothing at all when it is discarded", async () => {
    const inner = createRecordingEmailSender();
    const deferred = createDeferredEmailSender(inner);

    await deferred.send(email("one@example.com"));
    deferred.discard();
    await deferred.flush();

    expect(inner.sent).toHaveLength(0);
    expect(deferred.held).toHaveLength(0);
  });

  it("empties itself as it flushes, so a second flush cannot resend", async () => {
    const inner = createRecordingEmailSender();
    const deferred = createDeferredEmailSender(inner);

    await deferred.send(email("one@example.com"));
    await deferred.flush();
    await deferred.flush();

    expect(inner.sent).toHaveLength(1);
  });

  it("keeps what it could not deliver, and does not resend what already went out", async () => {
    const sent: string[] = [];
    const failing: EmailSender = {
      send: (outbound) => {
        if (outbound.to === "two@example.com") {
          return Promise.reject(new Error("the provider refused"));
        }
        sent.push(outbound.to);
        return Promise.resolve();
      },
    };
    const deferred = createDeferredEmailSender(failing);

    await deferred.send(email("one@example.com"));
    await deferred.send(email("two@example.com"));
    await expect(deferred.flush()).rejects.toThrow("the provider refused");

    expect(sent).toEqual(["one@example.com"]);
    expect(deferred.held.map((held) => held.to)).toEqual(["two@example.com"]);
  });
});
