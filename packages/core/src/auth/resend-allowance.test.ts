import {
  RESEND_LIMITS,
  resendAllowance,
  type ResendLimits,
} from "./resend-allowance";

const NOW = new Date("2026-09-12T12:00:00.000Z");
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** `n` milliseconds before {@link NOW}. */
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);

describe("resendAllowance", () => {
  it("allows the first resend, with nothing behind it", () => {
    expect(resendAllowance({ sentAt: [], now: NOW })).toEqual({
      state: "allowed",
    });
  });

  describe("the one-a-minute floor", () => {
    it("refuses a second send within the minute and says how long to wait", () => {
      expect(resendAllowance({ sentAt: [ago(20 * 1000)], now: NOW })).toEqual({
        state: "too-soon",
        retryAfterMs: 40 * 1000,
      });
    });

    it("allows one at exactly a minute, so the gap is not silently 61 seconds", () => {
      expect(resendAllowance({ sentAt: [ago(MINUTE)], now: NOW })).toEqual({
        state: "allowed",
      });
    });

    it("measures from the newest send, whatever order they arrive in", () => {
      // An adapter is free to return rows oldest-first or newest-first; the
      // decision must not depend on which.
      const result = resendAllowance({
        sentAt: [ago(50 * MINUTE), ago(10 * 1000)],
        now: NOW,
      });
      expect(result).toEqual({ state: "too-soon", retryAfterMs: 50 * 1000 });
    });

    it("still applies when every earlier send has aged out of the window", () => {
      // The floor is about not sending two messages back to back, so a send
      // outside the hour still counts towards it.
      expect(
        resendAllowance({ sentAt: [ago(HOUR + 1000), ago(5000)], now: NOW }),
      ).toEqual({ state: "too-soon", retryAfterMs: 55 * 1000 });
    });
  });

  describe("the three-an-hour ceiling", () => {
    it("refuses the fourth send in the window", () => {
      const result = resendAllowance({
        sentAt: [ago(55 * MINUTE), ago(30 * MINUTE), ago(5 * MINUTE)],
        now: NOW,
      });
      expect(result).toEqual({
        state: "too-many",
        // The oldest send ages out five minutes from now, freeing a slot.
        retryAfterMs: 5 * MINUTE,
      });
    });

    it("allows a send once the oldest of three has aged out", () => {
      expect(
        resendAllowance({
          sentAt: [ago(HOUR), ago(30 * MINUTE), ago(2 * MINUTE)],
          now: NOW,
        }),
      ).toEqual({ state: "allowed" });
    });

    it("allows the third send, because three an hour means three and not two", () => {
      expect(
        resendAllowance({
          sentAt: [ago(40 * MINUTE), ago(20 * MINUTE)],
          now: NOW,
        }),
      ).toEqual({ state: "allowed" });
    });

    it("reports the hour rather than the minute when both bind", () => {
      // Told "wait 45 seconds", a caller who waits 45 seconds is refused again.
      // The longer wait is the true one.
      const result = resendAllowance({
        sentAt: [ago(50 * MINUTE), ago(20 * MINUTE), ago(15 * 1000)],
        now: NOW,
      });
      expect(result).toEqual({ state: "too-many", retryAfterMs: 10 * MINUTE });
    });

    it("never reports a negative wait, whatever the clock says", () => {
      // A send timestamped in the future — clock skew between app and database
      // — must not produce a retry hint that reads as "already allowed".
      const result = resendAllowance({
        sentAt: [ago(-5000), ago(10 * MINUTE), ago(20 * MINUTE)],
        now: NOW,
      });
      expect(result.state).toBe("too-many");
      expect(
        result.state === "allowed" ? 0 : result.retryAfterMs,
      ).toBeGreaterThanOrEqual(0);
    });
  });

  describe("the limits themselves", () => {
    it("ships three an hour and one a minute", () => {
      // Spelled out rather than derived: the workstream records this as a value
      // to tune, so a change to it should turn a test red and be noticed.
      expect(RESEND_LIMITS).toEqual({
        maxPerWindow: 3,
        windowMs: 3_600_000,
        minimumIntervalMs: 60_000,
      });
    });

    it("is tunable without editing the decision", () => {
      const strict: ResendLimits = {
        maxPerWindow: 1,
        windowMs: HOUR,
        minimumIntervalMs: 0,
      };
      expect(
        resendAllowance({
          sentAt: [ago(30 * MINUTE)],
          now: NOW,
          limits: strict,
        }),
      ).toEqual({ state: "too-many", retryAfterMs: 30 * MINUTE });
    });
  });
});
