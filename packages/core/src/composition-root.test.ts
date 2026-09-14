import { createHeldBackgroundTasks } from "./adapters/held-background-tasks";
import type { EmailSender, OutboundEmail } from "./auth/ports/email-sender";
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
    backgroundTasks: createHeldBackgroundTasks(),
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

  it("wires the Claim's rate limiter, bound so a transport never holds the secret", async () => {
    const { services, close } = build(fixedClock("2026-09-12T10:00:00.000Z"));

    expect(typeof services.claimRateLimiter.admit).toBe("function");
    expect(Object.keys(services.claimRateLimiter)).toEqual(["admit"]);
    await close();
  });

  it("wires the resend action's per-client-address limiter the same way (#158)", async () => {
    const { services, close } = build(fixedClock("2026-09-12T10:00:00.000Z"));

    expect(Object.keys(services.resendClientRateLimiter)).toEqual(["admit"]);
    await close();
  });

  it("wires the sign-in form's per-client-address limiter the same way (#180)", async () => {
    const { services, close } = build(fixedClock("2026-09-12T10:00:00.000Z"));

    expect(Object.keys(services.signInClientRateLimiter)).toEqual(["admit"]);
    await close();
  });

  it("wires the password reset request form's per-client-address limiter the same way, and the resetter (#192)", async () => {
    const { services, close } = build(fixedClock("2026-09-12T10:00:00.000Z"));

    expect(Object.keys(services.resetRequestClientRateLimiter)).toEqual([
      "admit",
    ]);
    expect(Object.keys(services.passwordResetter).sort()).toEqual([
      "request",
      "reset",
    ]);
    expect(services.resetRequestUrl).toBe(
      "http://localhost:3000/reset-password",
    );
    await close();
  });

  /**
   * The header search (ADR-0012, #254): a read-only index of claimed Handles,
   * and its per-client-address limiter bound like the others, so the route
   * never holds the secret.
   */
  it("wires the header search's read-only index and its per-client-address limiter", async () => {
    const { services, close } = build(fixedClock("2026-09-12T10:00:00.000Z"));

    expect(Object.keys(services.handleSearch)).toEqual([
      "claimedKeysContaining",
    ]);
    expect(Object.keys(services.searchClientRateLimiter)).toEqual(["admit"]);
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
      backgroundTasks: createHeldBackgroundTasks(),
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

/**
 * **Every email the services send goes out after the answer**
 * ([#216](https://github.com/joshstothard/3moji/issues/216)). The provider
 * here never answers, or fails; what is asserted is that the caller is not
 * made to wait for it, and that a failure is reported under the event naming
 * which email it was. The verification hook needs a dispatch store that can
 * write, so its half is proved in `create-auth.test.ts`; the Claim's
 * post-commit flush needs a transaction, so its half is proved against
 * Postgres in `claim.integration.test.ts`.
 */
describe("createCoreServices sends email after the answer (#216)", () => {
  const STILL_WAITING = "still waiting on the provider";
  const EMAIL: OutboundEmail = {
    to: "owner@example.com",
    subject: "Someone tried to sign up with your 3moji email",
    text: "Somebody just tried to claim a 3moji handle using this email address.",
    html: "<p>Somebody just tried to claim a 3moji handle using this email address.</p>",
  };
  const USER = {
    id: "user-1",
    name: "",
    email: "owner@example.com",
    emailVerified: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };

  /** Whether `promise` settles before a macrotask runs, before any I/O could. */
  const answeredOrWaiting = (promise: Promise<void>): Promise<string> =>
    Promise.race([
      promise.then(() => "answered"),
      new Promise<string>((resolve) => {
        setImmediate(() => {
          resolve(STILL_WAITING);
        });
      }),
    ]);

  const neverAnswers: EmailSender = {
    send: () => new Promise<void>(() => undefined),
  };
  const failing: EmailSender = {
    send: () => Promise.reject(new Error("the provider is unavailable")),
  };

  const wired = (provider: EmailSender) => {
    const tasks = createHeldBackgroundTasks();
    const handle = createDatabase({
      url: "postgresql://app:app@localhost:5432/app_test",
      nodeEnv: "test",
    });
    const services = createCoreServices({
      clock: fixedClock("2026-09-12T10:00:00.000Z"),
      db: handle.db,
      backgroundTasks: tasks,
      auth: {
        emailSender: provider,
        baseUrl: "http://localhost:3000",
        secret: "a".repeat(32),
        from: "3moji <no-reply@mail.3moji.me>",
      },
    });
    const resetEmail = () =>
      services.auth.options.emailAndPassword.sendResetPassword({
        user: USER,
        url: "http://localhost:3000/api/auth/reset-password/token",
        token: "token",
      });
    return { services, tasks, resetEmail, close: handle.close };
  };

  it("hands out a sender for the claim-collision notice that does not wait on the provider", async () => {
    const { services, tasks, close } = wired(neverAnswers);

    expect(await answeredOrWaiting(services.emailSender.send(EMAIL))).toBe(
      "answered",
    );
    expect(tasks.pending()).toBe(1);
    await close();
  });

  it("wires Better Auth's reset email so it does not wait on the provider either", async () => {
    const { tasks, resetEmail, close } = wired(neverAnswers);

    expect(await answeredOrWaiting(resetEmail())).toBe("answered");
    expect(tasks.pending()).toBe(1);
    await close();
  });

  it("reports a failed send under the event that names which email it was", async () => {
    const { services, tasks, resetEmail, close } = wired(failing);

    await services.emailSender.send(EMAIL);
    await resetEmail();
    await tasks.release();

    expect(tasks.failures.map((failure) => failure.event)).toEqual([
      "claim_collision_email_failed",
      "auth_email_send_failed",
    ]);
    await close();
  });
});
