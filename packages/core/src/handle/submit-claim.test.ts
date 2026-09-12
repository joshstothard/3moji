import { createRecordingEmailSender } from "../auth/adapters/recording-email-sender";
import { RESPONSE_FLOOR_MS } from "../auth/response-floor";
import { toHandleKey } from "../db/handle-key";
import type { AccountDirectory } from "../ports/account-directory";
import type {
  AccountCreated,
  ClaimStore,
  ExpiredHoldFreed,
} from "../ports/claim-store";
import type { Clock } from "../ports/clock";
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
}

const build = (scenario: Scenario = {}) => {
  const { clock, advance } = movableClock();
  const slept: number[] = [];
  const emailSender = createRecordingEmailSender();
  const calls: string[] = [];

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

  const submit = (segment: string = ICE) =>
    submitClaim({
      segment,
      email: EMAIL,
      password: PASSWORD,
      store,
      clock,
      directory,
      emailSender,
      resetRequestUrl: RESET_URL,
      from: FROM,
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
    });

  return { submit, emailSender, slept, calls };
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
      // A fresh Claim hashes a password and sends mail; a collision does one
      // SELECT and rolls back. Padding the fast branch is what makes the two
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
});
