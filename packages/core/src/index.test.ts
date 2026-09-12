import {
  authSchema,
  BLOCKED_EMOJI,
  candidateEmojiSet,
  claimableHandle,
  createCoreServices,
  createDatabase,
  createRecordingEmailSender,
  createResendEmailSender,
  createSystemClock,
  findEmojiByCodepoint,
  isClaimableEmoji,
  isReservedHandle,
  releasedEmojiSet,
  RESERVED_HANDLES,
  resolveDriver,
} from "./index";
import type {
  ClaimabilityResult,
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

  /**
   * The Reserved Handle list and the claim gate, through the public API alone.
   * `apps/web` reaches the domain only through this entry point, so an export
   * left out here is an unreachable guard.
   */
  it("exports the Reserved Handle list and the claim gate", () => {
    expect(BLOCKED_EMOJI).toHaveLength(9);
    expect(RESERVED_HANDLES.entries.length).toBeGreaterThan(0);

    // 🔪 is Food & Drink, so it is released and this is live protection.
    const blocked: ClaimabilityResult = claimableHandle("🍎🔪🍌");
    expect(blocked.ok ? undefined : blocked.reason).toBe("reserved");
    expect(claimableHandle("🍎🍌🍇").ok).toBe(true);
    expect(isReservedHandle("🍎🍎🍎")).toBe(true);
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
      db: handle.db,
      auth: {
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
