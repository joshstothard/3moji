import {
  authSchema,
  BIO_MAX_LENGTH,
  BLOCKED_EMOJI,
  DISPLAY_NAME_MAX_LENGTH,
  LINK_LIMIT,
  LINK_TITLE_MAX_LENGTH,
  validateProfile,
  candidateEmojiSet,
  claimableHandle,
  createCoreServices,
  createDatabase,
  createRecordingEmailSender,
  createResendEmailSender,
  createSystemClock,
  createDrizzleProfileStore,
  editProfile,
  profileEditAuthority,
  toHandleKey,
  findEmojiByCodepoint,
  isClaimableEmoji,
  isReservedHandle,
  releasedHandle,
  releaseHandle,
  releasedEmojiSet,
  RESERVED_HANDLES,
  resolveDriver,
} from "./index";
import type {
  ClaimabilityResult,
  ReleaseStore,
  Clock,
  CoreDependencies,
  CoreServices,
  EmojiSetEntry,
  ProfileDraft,
  ProfileEditAuthority,
  ProfileValidationResult,
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
      // Better Auth's rate-limit model, under the name createAuth gives it (#158).
      "auth_rate_limit",
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

  /**
   * The Release, through the public API alone. `apps/web` reaches the domain
   * only through this entry point, so a use case left out here is an
   * unreachable one — and the account surface that will call it is Phase 4's.
   */
  it("exports the Release use case, its port and the tombstone table", () => {
    expect(typeof releaseHandle).toBe("function");
    expect(releasedHandle).toBeDefined();
    // The port is a type, so the annotation is the assertion: this file does
    // not compile if `ReleaseStore` is not exported.
    const store: ReleaseStore | undefined = undefined;
    expect(store).toBeUndefined();
  });

  /**
   * The Profile's field limits, through the public API alone. The form and the
   * server action that call this are #106's; an export left out here is a
   * limit that lives nowhere the transport layer can reach, which is the exact
   * failure `data-model.md` § Profile says the domain enforcement exists to
   * prevent.
   */
  it("exports the Profile field limits and their guard", () => {
    expect(DISPLAY_NAME_MAX_LENGTH).toBe(30);
    expect(BIO_MAX_LENGTH).toBe(160);
    expect(LINK_LIMIT).toBe(10);
    expect(LINK_TITLE_MAX_LENGTH).toBe(40);

    const draft: ProfileDraft = {
      displayName: "Ice Cube",
      bio: "Three emoji, said aloud.",
      links: [{ title: "Home", url: "javascript:alert(1)" }],
    };
    const result: ProfileValidationResult = validateProfile(draft);
    expect(result).toEqual({
      ok: false,
      violations: [
        {
          field: "link.url",
          index: 0,
          rule: "unsupported-scheme",
          scheme: "javascript:",
        },
      ],
    });
  });

  /**
   * The Profile write path, reached from `apps/web` — the edit route, its
   * server action, and the transport-side authority composition all import
   * these. An export left out here is a rule the transport cannot reach, which
   * is how a limit or an authorisation check ends up reimplemented in a form.
   */
  it("exports the Profile write path and its authority rule", () => {
    expect(typeof editProfile).toBe("function");
    expect(typeof createDrizzleProfileStore).toBe("function");
    expect(typeof profileEditAuthority).toBe("function");

    const key = toHandleKey("\u{1F9CA}\u{1F9CA}\u{1F9CA}");
    if (key === undefined) throw new Error("the test Handle must canonicalise");

    const verdict: ProfileEditAuthority = profileEditAuthority({
      viewer: { userId: "somebody-else" },
      owned: undefined,
      requested: key,
    });
    expect(verdict).toEqual({ state: "no-handle" });
  });
});
