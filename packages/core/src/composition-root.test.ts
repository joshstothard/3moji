import { createRecordingEmailSender } from "./auth/adapters/recording-email-sender";
import { createCoreServices } from "./composition-root";
import { createDatabase } from "./db/client";
import type { Clock } from "./ports/clock";

const fixedClock = (at: string): Clock => ({ now: () => new Date(at) });

const build = (clock: Clock) => {
  const handle = createDatabase({
    url: "postgresql://app:app@localhost:5432/app_test",
    nodeEnv: "test",
  });
  const services = createCoreServices({
    clock,
    db: handle.db,
    auth: {
      emailSender: createRecordingEmailSender(),
      baseUrl: "http://localhost:3000",
      secret: "a".repeat(32),
      from: "3moji <no-reply@mail.3moji.me>",
    },
  });
  return { services, close: handle.close };
};

describe("createCoreServices", () => {
  it("exposes the clock it was given", async () => {
    const { services, close } = build(fixedClock("2026-09-12T10:00:00.000Z"));

    expect(services.clock.now().toISOString()).toBe("2026-09-12T10:00:00.000Z");
    await close();
  });

  it("reads time through the injected clock rather than the system clock", async () => {
    const { services, close } = build(fixedClock("1999-12-31T23:59:59.000Z"));

    expect(services.clock.now().getFullYear()).toBe(1999);
    await close();
  });

  it("wires auth, so nothing else in the codebase constructs it", async () => {
    const { services, close } = build(fixedClock("2026-09-12T10:00:00.000Z"));

    expect(
      services.auth.options.emailAndPassword.requireEmailVerification,
    ).toBe(true);
    expect(
      services.auth.options.emailVerification.autoSignInAfterVerification,
    ).toBe(true);
    await close();
  });

  it("wires the Claim's unit of work", async () => {
    const { services, close } = build(fixedClock("2026-09-12T10:00:00.000Z"));

    expect(typeof services.claims.runInTransaction).toBe("function");
    await close();
  });

  /**
   * The Release's unit of work, wired **separately from the Claim's**. They are
   * two ports rather than one because `deleteAccount` has no business being
   * reachable from the claim path (Interface Segregation, in
   * `docs/development/engineering-standards.md`).
   */
  it("wires the Release's unit of work", async () => {
    const { services, close } = build(fixedClock("2026-09-12T10:00:00.000Z"));

    expect(typeof services.releases.runInTransaction).toBe("function");
    expect(Object.keys(services.claims)).toEqual(["runInTransaction"]);
    await close();
  });

  /**
   * The read/write split, asserted rather than described. The Handle repository
   * is read-only on purpose — ADR-0004's claim is a transaction, and a port
   * that could also write would let a caller write without one. The writes live
   * only on the object `runInTransaction` hands to its callback, so a new write
   * method appearing here is a design change that has to turn this red first.
   */
  it("keeps the Handle repository read-only, so nothing can write a hold without a transaction", async () => {
    const { services, close } = build(fixedClock("2026-09-12T10:00:00.000Z"));

    expect(Object.keys(services.handles)).toEqual(["availabilityOf"]);
    await close();
  });

  /**
   * The same read/write split for the Profile, and the same reason. Editing a
   * Profile rewrites the row and its whole Link list as one act (#106), so
   * those writes belong on a unit of work rather than on the port a visitor's
   * page read holds. A write verb appearing here has to turn this red first.
   *
   * It also pins that the adapter is constructed **here and nowhere else**: the
   * composition root is the only place that wires one, so a route handler
   * reaching for `createDrizzleProfileRepository` itself has no seam a test can
   * substitute at.
   */
  it("wires a read-only Profile repository", async () => {
    const { services, close } = build(fixedClock("2026-09-12T10:00:00.000Z"));

    // Two **reads** — the Profile behind one Handle, and the display names
    // behind a listing's rows (#109). Both are named here rather than counted,
    // so adding a third still has to turn this red and be read as a verb.
    expect(Object.keys(services.profiles)).toEqual([
      "profileOf",
      "displayNamesOf",
    ]);
    await close();
  });

  /**
   * The other half of that split: the Profile's writes exist, and they exist
   * **only** on a unit of work. `runInTransaction` being the whole of this
   * port's surface is what makes "a Link list is rewritten in one transaction"
   * structural rather than a convention a caller is trusted to follow.
   */
  it("wires the Profile's unit of work, with the writes only inside it", async () => {
    const { services, close } = build(fixedClock("2026-09-12T10:00:00.000Z"));

    expect(Object.keys(services.profileEdits)).toEqual(["runInTransaction"]);
    await close();
  });

  it("passes transport plugins through to auth", async () => {
    const handle = createDatabase({
      url: "postgresql://app:app@localhost:5432/app_test",
      nodeEnv: "test",
    });
    const marker = { id: "marker-plugin" };
    const services = createCoreServices({
      clock: fixedClock("2026-09-12T10:00:00.000Z"),
      db: handle.db,
      auth: {
        emailSender: createRecordingEmailSender(),
        baseUrl: "http://localhost:3000",
        secret: "a".repeat(32),
        from: "3moji <no-reply@mail.3moji.me>",
        plugins: [marker],
      },
    });

    expect(services.auth.options.plugins).toContainEqual(marker);
    await handle.close();
  });
});
