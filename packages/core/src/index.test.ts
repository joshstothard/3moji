import {
  authSchema,
  candidateEmojiSet,
  createCoreServices,
  createDatabase,
  createRecordingEmailSender,
  createResendEmailSender,
  createSystemClock,
  findEmojiByCodepoint,
  isClaimableEmoji,
  releasedEmojiSet,
  resolveDriver,
} from "./index";
import type {
  Clock,
  CoreDependencies,
  CoreServices,
  EmojiSetEntry,
} from "./index";

describe("package entry point", () => {
  it("exports the composition root", () => {
    expect(typeof createCoreServices).toBe("function");
  });

  it("exports the system clock adapter", () => {
    expect(typeof createSystemClock).toBe("function");
  });

  it("exports the database factory and driver resolver", () => {
    expect(typeof createDatabase).toBe("function");
    expect(typeof resolveDriver).toBe("function");
  });

  it("exports both email sender adapters", () => {
    expect(typeof createRecordingEmailSender).toBe("function");
    expect(typeof createResendEmailSender).toBe("function");
  });

  it("exports the Emoji Set and a lookup by code point", () => {
    expect(candidateEmojiSet).toHaveLength(1053);
    expect(releasedEmojiSet).toHaveLength(307);

    const apple: EmojiSetEntry | undefined = findEmojiByCodepoint("🍎");
    expect(apple?.spokenName).toBe("red apple");
    expect(isClaimableEmoji("🍎")).toBe(true);
    expect(isClaimableEmoji("😀")).toBe(false);
  });

  it("exports the auth schema keyed the way Better Auth expects", () => {
    expect(Object.keys(authSchema).sort()).toEqual([
      "account",
      "session",
      "user",
      "verification",
    ]);
  });

  it("builds a database handle through the public API alone", async () => {
    const handle = createDatabase({
      url: "postgresql://app:app@localhost:5432/app_test",
      nodeEnv: "test",
    });
    expect(handle.driver).toBe("node-postgres");
    await handle.close();
  });

  it("wires a usable domain surface through the public API alone", async () => {
    const clock: Clock = { now: () => new Date("2026-09-12T00:00:00.000Z") };
    const handle = createDatabase({
      url: "postgresql://app:app@localhost:5432/app_test",
      nodeEnv: "test",
    });
    const deps: CoreDependencies = {
      clock,
      auth: {
        db: handle.db,
        emailSender: createRecordingEmailSender(),
        baseUrl: "http://localhost:3000",
        secret: "a".repeat(32),
        from: "3moji <no-reply@mail.3moji.me>",
      },
    };
    const services: CoreServices = createCoreServices(deps);

    expect(services.clock.now().toISOString()).toBe("2026-09-12T00:00:00.000Z");
    expect(
      services.auth.options.emailAndPassword.requireEmailVerification,
    ).toBe(true);
    await handle.close();
  });
});
