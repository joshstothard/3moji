import { createInMemoryClaimRateLimitStore } from "../adapters/in-memory-claim-rate-limit-store";
import { createInMemoryVerificationDispatchStore } from "../adapters/in-memory-verification-dispatch-store";
import type {
  AccountDirectory,
  AccountRecord,
} from "../ports/account-directory";
import type { Clock } from "../ports/clock";
import { RESEND_LIMITS } from "./resend-allowance";
import {
  resendVerification,
  type VerificationMailer,
} from "./resend-verification";
import {
  createResendClientRateLimiter,
  type ResendClientRateLimiter,
} from "./resend-rate-limit";
import { RESPONSE_FLOOR_MS } from "./response-floor";

const NOW = new Date("2026-09-12T12:00:00.000Z");
const MINUTE = 60 * 1000;
const USER = "user-1";
const STORED_EMAIL = "claimant@example.com";

const ago = (ms: number): Date => new Date(NOW.getTime() - ms);

const UNVERIFIED: AccountRecord = {
  userId: USER,
  email: STORED_EMAIL,
  emailVerified: false,
};

interface Scenario {
  readonly account?: AccountRecord | undefined;
  /** When this Account's earlier links went out. */
  readonly sentAt?: readonly Date[];
  /** Milliseconds the send is pretended to take. */
  readonly costMs?: number;
  /** The per-client-address limit; admits everything unless a test says so. */
  readonly clientLimiter?: (clock: Clock) => ResendClientRateLimiter;
}

const build = (scenario: Scenario = {}) => {
  let now = NOW.getTime();
  const clock: Clock = { now: () => new Date(now) };
  const slept: number[] = [];
  const calls: string[] = [];
  /** Every collaborator call, the client-address limit included, in order. */
  const sequence: string[] = [];
  const dispatches = createInMemoryVerificationDispatchStore();

  const realLimiter = scenario.clientLimiter?.(clock);
  const clientLimiter: ResendClientRateLimiter = {
    admit: (clientAddress) => {
      sequence.push(`admit(${String(clientAddress)})`);
      return realLimiter === undefined
        ? Promise.resolve({ state: "admitted" })
        : realLimiter.admit(clientAddress);
    },
  };

  const directory: AccountDirectory = {
    byEmail: (email) => {
      calls.push(`byEmail(${email})`);
      sequence.push(`byEmail(${email})`);
      return Promise.resolve(
        "account" in scenario ? scenario.account : UNVERIFIED,
      );
    },
    handleOf: () => Promise.resolve(undefined),
  };

  const mailer: VerificationMailer = {
    send: (email) => {
      calls.push(`send(${email})`);
      now += scenario.costMs ?? 0;
      return Promise.resolve();
    },
  };

  // An object, not a defaulted parameter: a default would replace an explicit
  // `undefined`, which is exactly the unreadable address a test must pass.
  const resend = (
    email = "Claimant@Example.com",
    { clientAddress }: { readonly clientAddress: string | undefined } = {
      clientAddress: "203.0.113.7",
    },
  ) =>
    resendVerification({
      email,
      clientAddress,
      clientLimiter,
      directory,
      dispatches,
      mailer,
      clock,
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
    });

  const seed = async (): Promise<void> => {
    for (const [index, sentAt] of (scenario.sentAt ?? []).entries()) {
      await dispatches.record({
        userId: USER,
        tokenHash: `hash-${String(index)}`,
        sentAt,
      });
    }
  };

  return { resend, seed, calls, sequence, slept, dispatches };
};

describe("resendVerification", () => {
  describe("the limits, per Account", () => {
    it("sends when nothing has gone out yet", async () => {
      const { resend, calls } = build();

      expect(await resend()).toEqual({ state: "sent" });
      // The **stored** address, not the typed one: the mailer looks the Account
      // up again, and a difference in case must not become a miss.
      expect(calls).toContain(`send(${STORED_EMAIL})`);
    });

    it("refuses a fourth link inside the hour", async () => {
      const { resend, seed, calls } = build({
        sentAt: [ago(50 * MINUTE), ago(30 * MINUTE), ago(10 * MINUTE)],
      });
      await seed();

      expect(await resend()).toEqual({
        state: "too-many",
        retryAfterMs: 10 * MINUTE,
      });
      expect(calls).not.toContain(`send(${STORED_EMAIL})`);
    });

    it("refuses a second link inside the minute", async () => {
      const { resend, seed, calls } = build({ sentAt: [ago(15 * 1000)] });
      await seed();

      expect(await resend()).toEqual({
        state: "too-soon",
        retryAfterMs: 45 * 1000,
      });
      expect(calls).not.toContain(`send(${STORED_EMAIL})`);
    });

    it("asks the limit before sending, not after", async () => {
      // A limit consulted after the send is a log line.
      const { resend, seed, calls } = build({ sentAt: [ago(10 * 1000)] });
      await seed();

      await resend();

      expect(calls).toEqual([`byEmail(Claimant@Example.com)`]);
    });

    it("counts the sign-up link, so three an hour bounds the mail we send", async () => {
      // Every issued token is recorded, the sign-up one included. Counting only
      // button presses would let a fresh Claim be followed by three more.
      const { resend, seed } = build({
        sentAt: [ago(40 * MINUTE), ago(20 * MINUTE), ago(2 * MINUTE)],
      });
      await seed();

      expect((await resend()).state).toBe("too-many");
    });

    it("ships the limits #15 asked for", () => {
      expect(RESEND_LIMITS.maxPerWindow).toBe(3);
      expect(RESEND_LIMITS.minimumIntervalMs).toBe(MINUTE);
    });
  });

  describe("what it will not reveal", () => {
    it("answers an unknown address exactly as it answers a real one", async () => {
      const real = build();
      const unknown = build({ account: undefined });

      expect(await unknown.resend("nobody@example.com")).toEqual(
        await real.resend(),
      );
    });

    it("sends nothing for an unknown address", async () => {
      const { resend, calls } = build({ account: undefined });

      await resend("nobody@example.com");

      expect(calls).toEqual(["byEmail(nobody@example.com)"]);
    });

    it("answers an already-verified address the same way, and sends nothing", async () => {
      const { resend, calls } = build({
        account: { ...UNVERIFIED, emailVerified: true },
      });

      expect(await resend()).toEqual({ state: "sent" });
      expect(calls).toEqual(["byEmail(Claimant@Example.com)"]);
    });

    it("pads a refusal to the same floor as a send", async () => {
      // Without this, a fast "too-many" identifies an address as a real,
      // unverified Account — an enumeration oracle the response body carefully
      // avoids being.
      const refused = build({ sentAt: [ago(5 * 1000)] });
      await refused.seed();
      await refused.resend();

      const sent = build({ costMs: 0 });
      await sent.resend();

      expect(refused.slept).toEqual([RESPONSE_FLOOR_MS]);
      expect(sent.slept).toEqual([RESPONSE_FLOOR_MS]);
    });

    it("does not pad past the floor when the provider was slow", async () => {
      const { resend, slept } = build({ costMs: RESPONSE_FLOOR_MS + 50 });

      await resend();

      expect(slept).toEqual([]);
    });
  });

  describe("the limit, per client address (#158)", () => {
    /** Refuses everything: the limit is exhausted before the test begins. */
    const exhausted = (): ResendClientRateLimiter => ({
      admit: () =>
        Promise.resolve({ state: "rate-limited", retryAfterMs: 20 * MINUTE }),
    });

    it("is asked before anything reads the address, and a refusal reads nothing", async () => {
      const { resend, calls, sequence } = build({ clientLimiter: exhausted });

      expect(await resend()).toEqual({
        state: "too-many",
        retryAfterMs: 20 * MINUTE,
      });
      // Asked after the directory read, an unknown address would answer `sent`
      // before the limit was consulted, and unknown addresses would be
      // unlimited.
      expect(sequence).toEqual(["admit(203.0.113.7)"]);
      expect(calls).toEqual([]);
    });

    it("is handed the address the transport read, unreadable included", async () => {
      const { resend, sequence } = build();

      await resend("Claimant@Example.com", { clientAddress: undefined });

      expect(sequence[0]).toBe("admit(undefined)");
    });

    it("counts every request, so an unknown address is limited exactly as a registered one", async () => {
      const limiter = (clock: Clock) =>
        createResendClientRateLimiter({
          store: createInMemoryClaimRateLimitStore(),
          clock,
          secret: "s".repeat(32),
        });
      const registered = build({ clientLimiter: limiter });
      const unknown = build({ account: undefined, clientLimiter: limiter });

      const outcomes = async (
        scenario: ReturnType<typeof build>,
        email: string,
      ) => {
        const seen: string[] = [];
        for (let request = 0; request < 10; request += 1) {
          seen.push((await scenario.resend(email)).state);
        }
        return { seen, eleventh: await scenario.resend(email) };
      };
      const forRegistered = await outcomes(registered, "claimant@example.com");
      const forUnknown = await outcomes(unknown, "nobody@example.com");

      // The two really took different paths before the limit bound: only the
      // registered address was ever mailed…
      const sends = (scenario: ReturnType<typeof build>) =>
        scenario.calls.filter((call) => call.startsWith("send(")).length;
      expect({
        registered: sends(registered),
        unknown: sends(unknown),
      }).toEqual({ registered: 10, unknown: 0 });
      // …and the refusal is the same answer, down to the "when".
      expect(forUnknown.eleventh).toEqual(forRegistered.eleventh);
      expect(forRegistered.eleventh.state).toBe("too-many");
    });

    it("pads a client-address refusal to the same floor as a send", async () => {
      const refused = build({ clientLimiter: exhausted });
      await refused.resend();

      expect(refused.slept).toEqual([RESPONSE_FLOOR_MS]);
    });
  });

  it("records nothing itself, so a link can never go out unrecorded", async () => {
    // The dispatch row is written by createAuth's sendVerificationEmail hook,
    // the one place Better Auth reveals the token it signed. A use case that
    // recorded its own row would be recording a token it had to guess.
    const { resend, dispatches } = build();

    await resend();

    expect(dispatches.recorded).toEqual([]);
  });
});
