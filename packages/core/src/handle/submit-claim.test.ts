import { createHeldBackgroundTasks } from "../adapters/held-background-tasks";
import {
  createBackgroundEmailSender,
  DEFERRED_EMAIL_FAILURE_EVENTS,
} from "../auth/adapters/background-email-sender";
import { createRecordingEmailSender } from "../auth/adapters/recording-email-sender";
import type { EmailSender } from "../auth/ports/email-sender";
import { RESPONSE_FLOOR_MS } from "../auth/response-floor";
import { toHandleKey } from "../db/handle-key";
import type { AccountDirectory } from "../ports/account-directory";
import type {
  AccountCreated,
  ClaimStore,
  ExpiredHoldFreed,
} from "../ports/claim-store";
import type { Clock } from "../ports/clock";
import type { ClaimAdmission, ClaimRateLimiter } from "./claim-rate-limit";
import { submitClaim } from "./submit-claim";

const ICE = "\u{1F9CA}\u{1F9CA}\u{1F9CA}";
// 🍕🍕🍕 — a platform-owned Reserved entry in the shipped list.
const PIZZA = "\u{1F355}\u{1F355}\u{1F355}";
const KEY = toHandleKey(ICE);
if (KEY === undefined) throw new Error("the test Handle must canonicalise");

const EMAIL = "claimant@example.com";
const PASSWORD = "correct horse battery staple";
const RESET_URL = "https://3moji.me/reset-password";
const FROM = "3moji <no-reply@mail.3moji.me>";

const NOW = new Date("2026-09-12T12:00:00.000Z");
const CLIENT_ADDRESS = "203.0.113.7";

/** A limiter that admits everything, for the suites not about the limit. */
const admitsEverything: ClaimRateLimiter = {
  admit: () => Promise.resolve("admitted"),
};

/** A clock a test moves by hand, so nothing waits on real time. */
const movableClock = (): { clock: Clock; advance: (ms: number) => void } => {
  let now = NOW.getTime();
  return {
    clock: { now: () => new Date(now) },
    advance: (ms) => {
      now += ms;
    },
  };
};

interface Scenario {
  readonly account?: AccountCreated;
  /** Milliseconds the transaction is pretended to take. */
  readonly costMs?: number;
  readonly ownership?: "available" | "held" | "claimed";
  readonly freed?: ExpiredHoldFreed;
  /** What the rate limiter answers, or a rejection when it cannot count. */
  readonly admission?: ClaimAdmission | Error;
}

const build = (scenario: Scenario = {}) => {
  const { clock, advance } = movableClock();
  const slept: number[] = [];
  const emailSender = createRecordingEmailSender();
  const calls: string[] = [];
  const admitted: { clientAddress: string | undefined; email: string }[] = [];

  const rateLimiter: ClaimRateLimiter = {
    admit: (submission) => {
      admitted.push({ ...submission });
      calls.push("admit");
      const admission = scenario.admission ?? "admitted";
      return admission instanceof Error
        ? Promise.reject(admission)
        : Promise.resolve(admission);
    },
  };

  const store: ClaimStore = {
    async runInTransaction(work) {
      calls.push("begin");
      advance(scenario.costMs ?? 0);
      const outcome = await work({
        availabilityOf: () =>
          Promise.resolve(scenario.ownership ?? "available"),
        // #83's lazy expiry, which `claimHandle` calls before `createAccount`.
        // Recorded rather than stubbed silently: the ordering is a rule, and a
        // fake that answered without saying so would hide it.
        freeExpiredHold: (key, now) => {
          calls.push(`freeExpiredHold(${key}, ${now.toISOString()})`);
          return Promise.resolve(scenario.freed ?? { freed: false });
        },
        createAccount: (account) => {
          calls.push(`createAccount(${account.email})`);
          return Promise.resolve(
            scenario.account ?? { ok: true, userId: "user-1" },
          );
        },
        holdHandle: (hold) => {
          calls.push(`holdHandle(${hold.key})`);
          return Promise.resolve({ ok: true });
        },
      });
      calls.push(outcome.commit ? "commit" : "rollback");
      return outcome.value;
    },
  };

  const directory: AccountDirectory = {
    byEmail: (email) =>
      Promise.resolve({ userId: "user-9", email, emailVerified: true }),
    handleOf: () =>
      Promise.resolve({
        key: KEY,
        heldUntil: new Date("2026-09-13T12:00:00.000Z"),
        claimedAt: new Date("2026-09-12T09:00:00.000Z"),
      }),
  };

  const submit = (segment: string = ICE, email: string = EMAIL) =>
    submitClaim({
      segment,
      email,
      password: PASSWORD,
      store,
      clock,
      directory,
      emailSender,
      resetRequestUrl: RESET_URL,
      from: FROM,
      rateLimiter,
      clientAddress: CLIENT_ADDRESS,
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
    });

  return { submit, emailSender, slept, calls, admitted };
};

describe("submitClaim", () => {
  describe("the non-enumeration promise", () => {
    it("answers an already-registered address exactly as it answers a fresh one", async () => {
      // The whole promise, as one assertion: the two results are deep-equal, so
      // there is nothing a transport could branch on even if it wanted to.
      const fresh = await build().submit();
      const collision = await build({
        account: { ok: false, reason: "email-taken" },
      }).submit();

      expect(collision).toEqual(fresh);
      expect(fresh.state).toBe("pending");
    });

    it("carries no trace of the collision in the result", async () => {
      const { submit } = build({
        account: { ok: false, reason: "email-taken" },
      });

      const result = await submit();

      expect(JSON.stringify(result)).not.toMatch(/registered|taken|email/i);
    });

    it("takes the same time either way, so the timing does not answer the question", async () => {
      // A fresh Claim hashes a password and writes two rows; a collision does
      // one SELECT and rolls back. (Neither sends mail inside the floor, #216.) Padding the fast branch is what makes the two
      // indistinguishable — a body that reveals nothing is worthless if the
      // response time reveals everything.
      const fresh = build({ costMs: 120 });
      await fresh.submit();
      const collision = build({
        account: { ok: false, reason: "email-taken" },
        costMs: 4,
      });
      await collision.submit();

      expect(fresh.slept).toEqual([RESPONSE_FLOOR_MS - 120]);
      expect(collision.slept).toEqual([RESPONSE_FLOOR_MS - 4]);
    });

    it("tells the existing owner, which is the honest half of the promise", async () => {
      const { submit, emailSender } = build({
        account: { ok: false, reason: "email-taken" },
      });

      await submit();

      expect(emailSender.sent).toHaveLength(1);
      expect(emailSender.lastSent()?.to).toBe(EMAIL);
      expect(emailSender.lastSent()?.subject).toMatch(/tried to sign up/i);
      expect(emailSender.lastSent()?.text).toContain(ICE);
      expect(emailSender.lastSent()?.text).toContain(RESET_URL);
    });

    it("writes nothing when the address is taken", async () => {
      const { submit, calls } = build({
        account: { ok: false, reason: "email-taken" },
      });

      await submit();

      // The rollback is what makes "the submitter does not lose the Handle"
      // true: nothing was created, so nobody's Handle moved. The log is the
      // assertion rather than the result, because a result alone cannot tell a
      // rejection that wrote nothing from one that wrote and rolled back — and
      // **no `holdHandle` appears**, so the Handle was never taken from the
      // person submitting.
      expect(calls).toEqual([
        // The rate limit, which runs before anything opens (#157).
        "admit",
        "begin",
        // #83's lazy expiry still runs: it frees a dead hold on this key
        // whatever the address turns out to be, and it is a no-op here.
        `freeExpiredHold(${ICE}, ${NOW.toISOString()})`,
        `createAccount(${EMAIL})`,
        "rollback",
      ]);
    });

    it("sends no collision email on a fresh Claim", async () => {
      const { submit, emailSender } = build();
      await submit();
      expect(emailSender.sent).toEqual([]);
    });
  });

  describe("answers about a Handle rather than an address", () => {
    it("passes a taken Handle through, unpadded", async () => {
      // Availability is published live by the builder, so there is nothing to
      // conceal and no reason to make the page feel half a second slower.
      const { submit, slept } = build({ ownership: "claimed", costMs: 3 });

      const taken = await submit();

      expect(taken.state).toBe("taken");
      if (taken.state !== "taken") throw new Error("expected taken");
      expect(taken.handle.key).toBe(ICE);
      expect(taken.because).toBe("claimed");
      expect(slept).toEqual([]);
    });

    it("passes a Reserved Handle through as not-claimable", async () => {
      const { submit } = build();
      const result = await submit(PIZZA);
      expect(result.state).toBe("not-claimable");
    });

    it("passes a segment that is not a Handle through", async () => {
      const { submit } = build();
      const result = await submit("not-emoji");
      expect(result.state).toBe("not-a-handle");
      if (result.state !== "not-a-handle") throw new Error("expected refusal");
      // The unflattened failure travels, because its reasons are different
      // answers: a 308 for an odd spelling is not a 404.
      // `wrong-length` rather than `unknown-codepoint`: "not-emoji" is nine
      // code points, and length is checked before membership.
      expect(result.failure.reason).toBe("wrong-length");
    });
  });

  /**
   * [#157](https://github.com/joshstothard/3moji/issues/157): the rate limit
   * sits in front of the Claim, inside the same timing floor.
   */
  describe("the rate limit", () => {
    it("asks the limiter first, with the address as typed and the client address", async () => {
      const { submit, calls, admitted } = build();

      await submit(ICE, "  Claimant@Example.COM ");

      expect(calls[0]).toBe("admit");
      expect(calls[1]).toBe("begin");
      // The limiter normalises for itself, as `claimHandle` does; the
      // transport hands both of them the address as typed.
      expect(admitted).toEqual([
        { clientAddress: CLIENT_ADDRESS, email: "  Claimant@Example.COM " },
      ]);
    });

    it("answers rate-limited without opening the Claim or sending any email", async () => {
      const { submit, calls, emailSender } = build({
        admission: "rate-limited",
        account: { ok: false, reason: "email-taken" },
      });

      const result = await submit();

      expect(result).toEqual({ state: "rate-limited" });
      expect(calls).toEqual(["admit"]);
      expect(emailSender.sent).toEqual([]);
    });

    it("holds a rate-limited answer to the same floor as the answers about an address", async () => {
      const limited = build({ admission: "rate-limited" });
      await limited.submit();
      const collision = build({
        account: { ok: false, reason: "email-taken" },
      });
      await collision.submit();

      expect(limited.slept).toEqual([RESPONSE_FLOOR_MS]);
      expect(collision.slept).toEqual([RESPONSE_FLOOR_MS]);
    });

    it("carries nothing about which limit was hit, or when to try again", async () => {
      const result = await build({ admission: "rate-limited" }).submit();

      expect(Object.keys(result)).toEqual(["state"]);
    });

    it("rate-limits a registered address exactly as it rate-limits a new one", async () => {
      const fresh = build({ admission: "rate-limited" });
      const collision = build({
        admission: "rate-limited",
        account: { ok: false, reason: "email-taken" },
      });

      const answers = [await fresh.submit(), await collision.submit()];

      expect(answers[1]).toEqual(answers[0]);
      expect(collision.slept).toEqual(fresh.slept);
      expect(collision.calls).toEqual(fresh.calls);
    });

    it("fails closed: a limiter that cannot count refuses the Claim, padded, with nothing opened", async () => {
      const failure = new Error("the limiter's store is gone");
      const { submit, calls, slept, emailSender } = build({
        admission: failure,
      });

      await expect(submit()).rejects.toBe(failure);
      expect(calls).toEqual(["admit"]);
      expect(slept).toEqual([RESPONSE_FLOOR_MS]);
      expect(emailSender.sent).toEqual([]);
    });
  });

  /**
   * [#163](https://github.com/joshstothard/3moji/issues/163): a registered
   * address typed with capitals is the same Account, so it must be the same
   * answer, the same floor and the same notice to the owner.
   *
   * The fakes here compare **bytes**, as the real adapter and a database
   * holding Better Auth's lowercased rows do. A fake that lowercased on its own
   * would pass whether or not the domain normalised.
   */
  describe("an address typed with capitals", () => {
    const caseSensitive = () => {
      const { clock } = movableClock();
      const lookedUp: string[] = [];
      const slept: number[] = [];
      const emailSender = createRecordingEmailSender();

      const store: ClaimStore = {
        async runInTransaction(work) {
          const outcome = await work({
            availabilityOf: () => Promise.resolve("available"),
            freeExpiredHold: () => Promise.resolve({ freed: false }),
            createAccount: (account) => {
              const created: AccountCreated =
                account.email === EMAIL
                  ? { ok: false, reason: "email-taken" }
                  : { ok: true, userId: "user-1" };
              return Promise.resolve(created);
            },
            holdHandle: () => Promise.resolve({ ok: true }),
          });
          return outcome.value;
        },
      };

      const directory: AccountDirectory = {
        byEmail: (email) => {
          lookedUp.push(email);
          return Promise.resolve(
            email === EMAIL
              ? { userId: "user-9", email, emailVerified: true }
              : undefined,
          );
        },
        handleOf: () =>
          Promise.resolve({
            key: KEY,
            heldUntil: new Date("2026-09-13T12:00:00.000Z"),
            claimedAt: new Date("2026-09-12T09:00:00.000Z"),
          }),
      };

      const submit = (email: string) =>
        submitClaim({
          segment: ICE,
          email,
          password: PASSWORD,
          store,
          clock,
          directory,
          emailSender,
          resetRequestUrl: RESET_URL,
          from: FROM,
          rateLimiter: admitsEverything,
          clientAddress: CLIENT_ADDRESS,
          sleep: (ms) => {
            slept.push(ms);
            return Promise.resolve();
          },
        });

      const observed = () => ({
        lookedUp: [...lookedUp],
        slept: [...slept],
        mailedTo: emailSender.sent.map((sent) => sent.to),
      });

      return { submit, observed };
    };

    it("answers exactly as the registered address itself does, and tells the owner", async () => {
      const lowercase = caseSensitive();
      const asTyped = await lowercase.submit(EMAIL);
      const mixedCase = caseSensitive();
      const withCapitals = await mixedCase.submit("  Claimant@Example.COM ");

      expect(lowercase.observed()).toEqual({
        lookedUp: [EMAIL],
        slept: [RESPONSE_FLOOR_MS],
        mailedTo: [EMAIL],
      });
      expect(withCapitals).toEqual(asTyped);
      expect(mixedCase.observed()).toEqual(lowercase.observed());
    });
  });
});

/**
 * **The collision notice, sent the way production sends it**
 * ([#216](https://github.com/joshstothard/3moji/issues/216)): through the
 * background sender the composition root hands `submitClaim`. The provider
 * takes two seconds, or fails, when it is finally asked. A fresh Claim sends
 * nothing from inside `submitClaim` — its verification email leaves after the
 * commit, from the claim store — so it is the baseline the collision must
 * match.
 */
describe("submitClaim when the email provider is slow or failing (#216)", () => {
  const PROVIDER_MS = 2_000;

  const wired = (who: "fresh" | "collision", provider: "slow" | "failing") => {
    const { clock, advance } = movableClock();
    const delivered: string[] = [];
    const tasks = createHeldBackgroundTasks();
    const inner: EmailSender = {
      send: (email) => {
        advance(PROVIDER_MS);
        delivered.push(email.to);
        return provider === "slow"
          ? Promise.resolve()
          : Promise.reject(new Error("the provider is unavailable"));
      },
    };
    const emailSender = createBackgroundEmailSender({
      inner,
      tasks,
      event: DEFERRED_EMAIL_FAILURE_EVENTS.claimCollision,
    });

    const store: ClaimStore = {
      async runInTransaction(work) {
        const outcome = await work({
          availabilityOf: () => Promise.resolve("available"),
          freeExpiredHold: () => Promise.resolve({ freed: false }),
          createAccount: () =>
            Promise.resolve(
              who === "fresh"
                ? { ok: true, userId: "user-1" }
                : { ok: false, reason: "email-taken" },
            ),
          holdHandle: () => Promise.resolve({ ok: true }),
        });
        return outcome.value;
      },
    };

    const directory: AccountDirectory = {
      byEmail: (email) =>
        Promise.resolve({ userId: "user-9", email, emailVerified: true }),
      handleOf: () =>
        Promise.resolve({
          key: KEY,
          heldUntil: new Date("2026-09-13T12:00:00.000Z"),
          claimedAt: new Date("2026-09-12T09:00:00.000Z"),
        }),
    };

    const answer = async () => {
      const started = clock.now().getTime();
      const result = await submitClaim({
        segment: ICE,
        email: EMAIL,
        password: PASSWORD,
        store,
        clock,
        directory,
        emailSender,
        resetRequestUrl: RESET_URL,
        from: FROM,
        rateLimiter: admitsEverything,
        clientAddress: CLIENT_ADDRESS,
        sleep: (ms) => {
          advance(ms);
          return Promise.resolve();
        },
      });
      return { result, tookMs: clock.now().getTime() - started };
    };

    return { answer, tasks, delivered };
  };

  it("answers a collision at the floor though its notice takes two seconds, exactly as a fresh Claim", async () => {
    const fresh = wired("fresh", "slow");
    const collision = wired("collision", "slow");

    const answers = [await fresh.answer(), await collision.answer()];

    expect(answers[1]).toEqual(answers[0]);
    expect(answers[0]?.tookMs).toBe(RESPONSE_FLOOR_MS);
    expect(answers[0]?.result.state).toBe("pending");
    // Nothing reached the provider before the answer; afterwards, only the
    // existing owner was told — the two really took different paths.
    expect(collision.delivered).toEqual([]);
    await Promise.all([fresh.tasks.release(), collision.tasks.release()]);
    expect(collision.delivered).toEqual([EMAIL]);
    expect(fresh.delivered).toEqual([]);
  });

  it("answers pending for a collision when its notice fails, and the failure is reported once, after the answer", async () => {
    const fresh = wired("fresh", "failing");
    const collision = wired("collision", "failing");

    const answers = [await fresh.answer(), await collision.answer()];

    expect(answers[1]).toEqual(answers[0]);
    expect(answers[0]?.result.state).toBe("pending");
    expect(collision.tasks.failures).toEqual([]);
    await Promise.all([fresh.tasks.release(), collision.tasks.release()]);
    expect(collision.tasks.failures.map((failure) => failure.event)).toEqual([
      "claim_collision_email_failed",
    ]);
    expect(fresh.tasks.failures).toEqual([]);
  });
});
