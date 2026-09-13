import { createHeldBackgroundTasks } from "../adapters/held-background-tasks";
import { createInMemoryClaimRateLimitStore } from "../adapters/in-memory-claim-rate-limit-store";
import type { Clock } from "../ports/clock";
import {
  createBackgroundEmailSender,
  DEFERRED_EMAIL_FAILURE_EVENTS,
} from "./adapters/background-email-sender";
import type { EmailSender } from "./ports/email-sender";
import {
  requestPasswordReset,
  setNewPassword,
  type PasswordResetter,
  type SetNewPasswordOutcome,
} from "./password-reset";
import {
  createResetRequestClientRateLimiter,
  RESET_REQUEST_CLIENT_RATE_LIMIT,
  type ResetRequestClientRateLimiter,
} from "./reset-request-rate-limit";
import { RESPONSE_FLOOR_MS } from "./response-floor";

const NOW = new Date("2026-09-13T12:05:00.000Z");
const REGISTERED = "owner@example.com";
const UNREGISTERED = "nobody@example.com";
const CLIENT = "203.0.113.7";

/** A clock that `sleep` and the resetter both move, so time is observable. */
function world(options: { readonly sendCostMs?: number } = {}) {
  let now = NOW.getTime();
  const clock: Clock = { now: () => new Date(now) };
  const slept: number[] = [];
  const sleep = (ms: number): Promise<void> => {
    slept.push(ms);
    now += ms;
    return Promise.resolve();
  };
  const log: string[] = [];
  const mailed: string[] = [];
  const resetter: PasswordResetter = {
    request: (email) => {
      log.push("request");
      if (email === REGISTERED) {
        // Only a registered address costs a send.
        now += options.sendCostMs ?? 0;
        mailed.push(email);
      }
      return Promise.resolve(email.includes("@") ? "accepted" : "invalid");
    },
    reset: () => Promise.resolve({ state: "reset" }),
  };
  const store = createInMemoryClaimRateLimitStore();
  const realLimiter = createResetRequestClientRateLimiter({
    store,
    clock,
    secret: "s".repeat(32),
  });
  const clientLimiter: ResetRequestClientRateLimiter = {
    admit: (address) => {
      log.push("admit");
      return realLimiter.admit(address);
    },
  };
  return {
    clock,
    sleep,
    slept,
    log,
    mailed,
    resetter,
    clientLimiter,
    elapsed: () => now - NOW.getTime(),
  };
}

function ask(w: ReturnType<typeof world>, email: string) {
  return requestPasswordReset({
    email,
    clientAddress: CLIENT,
    clientLimiter: w.clientLimiter,
    resetter: w.resetter,
    clock: w.clock,
    sleep: w.sleep,
  });
}

describe("requestPasswordReset", () => {
  it("answers a registered and an unregistered address identically, though only one is mailed", async () => {
    const registered = world();
    const unregistered = world();

    const answers = [
      await ask(registered, REGISTERED),
      await ask(unregistered, UNREGISTERED),
    ];

    expect(answers).toEqual([{ state: "sent" }, { state: "sent" }]);
    // The two genuinely took different paths.
    expect(registered.mailed).toEqual([REGISTERED]);
    expect(unregistered.mailed).toEqual([]);
  });

  it("holds both answers back to the 500 ms floor", async () => {
    const registered = world({ sendCostMs: 120 });
    const unregistered = world();

    await ask(registered, REGISTERED);
    await ask(unregistered, UNREGISTERED);

    expect(registered.elapsed()).toBe(RESPONSE_FLOOR_MS);
    expect(unregistered.elapsed()).toBe(RESPONSE_FLOOR_MS);
  });

  it("asks the per-client limit before the request, and sends nothing once it refuses", async () => {
    const w = world();

    const answers = [];
    for (let i = 0; i <= RESET_REQUEST_CLIENT_RATE_LIMIT.maxPerWindow; i += 1) {
      answers.push(await ask(w, REGISTERED));
    }

    expect(answers.at(-1)).toEqual({ state: "rate-limited" });
    expect(w.mailed).toHaveLength(RESET_REQUEST_CLIENT_RATE_LIMIT.maxPerWindow);
    expect(w.log.slice(0, 2)).toEqual(["admit", "request"]);
    expect(w.log.at(-1)).toBe("admit");
  });

  it("refuses a registered and an unregistered address identically beyond the limit, padded to the floor", async () => {
    const outcomes = [];
    for (const email of [REGISTERED, UNREGISTERED]) {
      const w = world();
      for (
        let i = 0;
        i < RESET_REQUEST_CLIENT_RATE_LIMIT.maxPerWindow;
        i += 1
      ) {
        await ask(w, `someone-${String(i)}@example.com`);
      }
      const before = w.elapsed();
      const answer = await ask(w, email);
      outcomes.push({
        answer,
        took: w.elapsed() - before,
        mailed: w.mailed,
      });
    }

    expect(outcomes[0]).toEqual(outcomes[1]);
    expect(outcomes[0]).toEqual({
      answer: { state: "rate-limited" },
      took: RESPONSE_FLOOR_MS,
      mailed: [],
    });
  });

  it("answers invalid for an empty address without asking Better Auth, still counted and padded", async () => {
    const w = world();

    expect(await ask(w, "   ")).toEqual({ state: "invalid" });
    expect(w.log).toEqual(["admit"]);
    expect(w.elapsed()).toBe(RESPONSE_FLOOR_MS);
  });

  it("answers invalid when Better Auth's schema refuses the address", async () => {
    const w = world();

    expect(await ask(w, "not-an-address")).toEqual({ state: "invalid" });
  });

  it("trims the address before asking", async () => {
    const w = world();

    await ask(w, `  ${REGISTERED}  `);

    expect(w.mailed).toEqual([REGISTERED]);
  });

  it("rejects, padded, when the limiter cannot count, and asks nothing of Better Auth", async () => {
    const w = world();
    const failing: ResetRequestClientRateLimiter = {
      admit: () => Promise.reject(new Error("database unreachable")),
    };

    await expect(
      requestPasswordReset({
        email: REGISTERED,
        clientAddress: CLIENT,
        clientLimiter: failing,
        resetter: w.resetter,
        clock: w.clock,
        sleep: w.sleep,
      }),
    ).rejects.toThrow("database unreachable");
    expect(w.mailed).toEqual([]);
    expect(w.elapsed()).toBe(RESPONSE_FLOOR_MS);
  });
});

describe("setNewPassword", () => {
  const resetterAnswering = (outcome: SetNewPasswordOutcome) => {
    const calls: [string, string][] = [];
    const resetter: PasswordResetter = {
      request: () => Promise.resolve("accepted"),
      reset: (token, newPassword) => {
        calls.push([token, newPassword]);
        return Promise.resolve(outcome);
      },
    };
    return { resetter, calls };
  };

  it("passes the token and the new password to Better Auth and answers what it answers", async () => {
    const { resetter, calls } = resetterAnswering({ state: "reset" });

    const outcome = await setNewPassword({
      token: "tok",
      newPassword: "a new passphrase",
      resetter,
    });

    expect(outcome).toEqual({ state: "reset" });
    expect(calls).toEqual([["tok", "a new passphrase"]]);
  });

  it.each([
    { state: "invalid-link" },
    { state: "password-too-short" },
    { state: "password-too-long" },
  ] as const)("answers $state when Better Auth does", async (refusal) => {
    const { resetter } = resetterAnswering(refusal);

    expect(
      await setNewPassword({ token: "tok", newPassword: "x", resetter }),
    ).toEqual(refusal);
  });

  it("treats an empty token as an invalid link without asking Better Auth", async () => {
    const { resetter, calls } = resetterAnswering({ state: "reset" });

    expect(
      await setNewPassword({
        token: " ",
        newPassword: "long enough",
        resetter,
      }),
    ).toEqual({ state: "invalid-link" });
    expect(calls).toEqual([]);
  });
});

/**
 * **The send, as production wires it**
 * ([#216](https://github.com/joshstothard/3moji/issues/216)): Better Auth calls
 * the `sendResetPassword` hook for a registered address only, and that hook's
 * sender is the background one the composition root builds. The provider takes
 * two seconds, or fails, when it is finally asked.
 */
describe("requestPasswordReset when the email provider is slow or failing (#216)", () => {
  const PROVIDER_MS = 2_000;

  function wired(provider: "slow" | "failing") {
    let now = NOW.getTime();
    const clock: Clock = { now: () => new Date(now) };
    const delivered: string[] = [];
    const tasks = createHeldBackgroundTasks();
    const inner: EmailSender = {
      send: (email) => {
        now += PROVIDER_MS;
        delivered.push(email.to);
        return provider === "slow"
          ? Promise.resolve()
          : Promise.reject(new Error("the provider is unavailable"));
      },
    };
    const sender = createBackgroundEmailSender({
      inner,
      tasks,
      event: DEFERRED_EMAIL_FAILURE_EVENTS.auth,
    });
    const resetter: PasswordResetter = {
      request: async (email) => {
        if (email === REGISTERED) {
          await sender.send({
            to: email,
            subject: "Reset your 3moji password",
            text: "Reset your password: https://3moji.me/reset-password/token",
          });
        }
        return "accepted";
      },
      reset: () => Promise.resolve({ state: "reset" }),
    };
    const answer = async (email: string) => {
      const started = now;
      const outcome = await requestPasswordReset({
        email,
        clientAddress: CLIENT,
        clientLimiter: { admit: () => Promise.resolve({ state: "admitted" }) },
        resetter,
        clock,
        sleep: (ms) => {
          now += ms;
          return Promise.resolve();
        },
      });
      return { outcome, tookMs: now - started };
    };
    return { answer, tasks, delivered };
  }

  it("answers a registered address at the floor though its email takes two seconds, exactly as an unregistered one", async () => {
    const registered = wired("slow");
    const unregistered = wired("slow");

    const answers = [
      await registered.answer(REGISTERED),
      await unregistered.answer(UNREGISTERED),
    ];

    expect(answers[1]).toEqual(answers[0]);
    expect(answers[0]).toEqual({
      outcome: { state: "sent" },
      tookMs: RESPONSE_FLOOR_MS,
    });
    // Nothing reached the provider before the answer; afterwards, only the
    // registered address did, so the two really took different paths.
    expect(registered.delivered).toEqual([]);
    await Promise.all([
      registered.tasks.release(),
      unregistered.tasks.release(),
    ]);
    expect(registered.delivered).toEqual([REGISTERED]);
    expect(unregistered.delivered).toEqual([]);
  });

  it("answers sent for a registered address when the provider fails, and the failure is reported once, after the answer", async () => {
    const registered = wired("failing");
    const unregistered = wired("failing");

    const answers = [
      await registered.answer(REGISTERED),
      await unregistered.answer(UNREGISTERED),
    ];

    expect(answers[1]).toEqual(answers[0]);
    expect(answers[0]?.outcome).toEqual({ state: "sent" });
    expect(registered.tasks.failures).toEqual([]);
    await Promise.all([
      registered.tasks.release(),
      unregistered.tasks.release(),
    ]);
    expect(registered.tasks.failures.map((failure) => failure.event)).toEqual([
      "auth_email_send_failed",
    ]);
    expect(unregistered.tasks.failures).toEqual([]);
  });
});
