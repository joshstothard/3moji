import { createRecordingEmailSender } from "./recording-email-sender";

describe("createRecordingEmailSender", () => {
  it("records what it was asked to send instead of sending it", async () => {
    const sender = createRecordingEmailSender();

    await sender.send({
      to: "a@example.com",
      subject: "Verify your email",
      text: "http://localhost:3000/verify?token=abc",
    });

    expect(sender.sent).toEqual([
      {
        to: "a@example.com",
        subject: "Verify your email",
        text: "http://localhost:3000/verify?token=abc",
      },
    ]);
  });

  it("keeps them in order", async () => {
    const sender = createRecordingEmailSender();
    await sender.send({ to: "1@example.com", subject: "s1", text: "t1" });
    await sender.send({ to: "2@example.com", subject: "s2", text: "t2" });

    expect(sender.sent.map((email) => email.to)).toEqual([
      "1@example.com",
      "2@example.com",
    ]);
  });

  it("can be cleared between assertions", async () => {
    const sender = createRecordingEmailSender();
    await sender.send({ to: "a@example.com", subject: "s", text: "t" });
    sender.clear();

    expect(sender.sent).toEqual([]);
  });

  it("exposes the last email, which is what a test usually wants", async () => {
    const sender = createRecordingEmailSender();
    await sender.send({ to: "first@example.com", subject: "s1", text: "t1" });
    await sender.send({ to: "last@example.com", subject: "s2", text: "t2" });

    expect(sender.lastSent()?.to).toBe("last@example.com");
  });

  it("reports no last email before anything is sent", () => {
    expect(createRecordingEmailSender().lastSent()).toBeUndefined();
  });
});
