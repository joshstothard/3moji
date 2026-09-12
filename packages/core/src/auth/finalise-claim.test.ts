import { createInMemoryVerificationDispatchStore } from "../adapters/in-memory-verification-dispatch-store";
import { toHandleKey } from "../db/handle-key";
import type { AccountDirectory, OwnedHandle } from "../ports/account-directory";
import type {
  ClaimFinaliser,
  EmailVerification,
  HoldFinalised,
} from "../ports/claim-finaliser";
import { finaliseClaim } from "./finalise-claim";
import { verificationTokenFingerprint } from "./verification-token";

const ICE = "\u{1F9CA}\u{1F9CA}\u{1F9CA}";
const KEY = toHandleKey(ICE);
if (KEY === undefined) throw new Error("the test Handle must canonicalise");

const NOW = new Date("2026-09-12T12:00:00.000Z");
const USER = "user-1";

/** Two links for one Account, the second issued a minute after the first. */
const FIRST_TOKEN = "first.verification.token";
const SECOND_TOKEN = "second.verification.token";

const HELD: OwnedHandle = {
  key: KEY,
  heldUntil: new Date("2026-09-13T11:00:00.000Z"),
  claimedAt: null,
};

interface Scenario {
  readonly owned?: OwnedHandle | undefined;
  readonly verification?: EmailVerification;
  readonly hold?: HoldFinalised;
}

const build = (scenario: Scenario = {}) => {
  const dispatches = createInMemoryVerificationDispatchStore();
  const calls: string[] = [];

  const directory: AccountDirectory = {
    byEmail: () => Promise.resolve(undefined),
    handleOf: (userId) => {
      calls.push(`handleOf(${userId})`);
      return Promise.resolve("owned" in scenario ? scenario.owned : HELD);
    },
  };

  const finaliser: ClaimFinaliser = {
    async runInTransaction(work) {
      calls.push("begin");
      const outcome = await work({
        verifyEmail: (token) => {
          calls.push(`verifyEmail(${token})`);
          return Promise.resolve(
            scenario.verification ?? {
              ok: true,
              headers: new Headers({ "set-cookie": "session=abc; Path=/" }),
              signedIn: true,
            },
          );
        },
        finaliseHold: (userId, at) => {
          calls.push(`finaliseHold(${userId}, ${at.toISOString()})`);
          return Promise.resolve(scenario.hold ?? { ok: true, key: KEY });
        },
      });
      calls.push(outcome.commit ? "commit" : "rollback");
      return outcome.value;
    },
  };

  const finalise = (token: string) =>
    finaliseClaim({
      token,
      dispatches,
      directory,
      finaliser,
      clock: { now: () => NOW },
    });

  return { finalise, dispatches, calls };
};

/** Records the two links, oldest first, as the send hook would have. */
const recordBothLinks = async (
  dispatches: ReturnType<typeof createInMemoryVerificationDispatchStore>,
): Promise<void> => {
  await dispatches.record({
    userId: USER,
    tokenHash: verificationTokenFingerprint(FIRST_TOKEN),
    sentAt: new Date("2026-09-12T11:58:00.000Z"),
  });
  await dispatches.record({
    userId: USER,
    tokenHash: verificationTokenFingerprint(SECOND_TOKEN),
    sentAt: new Date("2026-09-12T11:59:00.000Z"),
  });
};

describe("finaliseClaim", () => {
  describe("each resend invalidates the previous link", () => {
    it("refuses the older link after a resend and says the Handle is still theirs", async () => {
      // The acceptance criterion, asserted the way it asks to be: an *older*
      // link is followed *after* a resend. Better Auth cannot do this for us —
      // its token is a signed JWT it never stores, so every link it has issued
      // stays valid for its hour.
      const { finalise, dispatches } = build();
      await recordBothLinks(dispatches);

      const result = await finalise(FIRST_TOKEN);

      expect(result).toEqual({ state: "link-superseded", key: ICE });
    });

    it("does not verify the address as a side effect of refusing the old link", async () => {
      // The freshness check is a read and happens before the transaction opens.
      // Reversed, a superseded link would still verify an email on its way to
      // being told it was superseded.
      const { finalise, dispatches, calls } = build();
      await recordBothLinks(dispatches);

      await finalise(FIRST_TOKEN);

      expect(calls).not.toContain(`verifyEmail(${FIRST_TOKEN})`);
      expect(calls).not.toContain("begin");
    });

    it("accepts the newest link", async () => {
      const { finalise, dispatches } = build();
      await recordBothLinks(dispatches);

      const result = await finalise(SECOND_TOKEN);

      expect(result.state).toBe("claimed");
    });

    it("accepts the only link when there has been no resend", async () => {
      const { finalise, dispatches } = build();
      await dispatches.record({
        userId: USER,
        tokenHash: verificationTokenFingerprint(FIRST_TOKEN),
        sentAt: new Date("2026-09-12T11:58:00.000Z"),
      });

      expect((await finalise(FIRST_TOKEN)).state).toBe("claimed");
    });
  });

  describe("the happy path", () => {
    it("finalises the Claim and carries the cookies that sign them in", async () => {
      const { finalise, dispatches, calls } = build();
      await recordBothLinks(dispatches);

      const result = await finalise(SECOND_TOKEN);

      expect(result.state).toBe("claimed");
      if (result.state !== "claimed") throw new Error("expected claimed");
      expect(result.key).toBe(ICE);
      // Without these forwarded, autoSignInAfterVerification verifies the
      // address and signs nobody in.
      expect(result.headers.get("set-cookie")).toBe("session=abc; Path=/");
      expect(calls).toContain("commit");
    });

    it("verifies and finalises inside one transaction, in that order", async () => {
      const { finalise, dispatches, calls } = build();
      await recordBothLinks(dispatches);

      await finalise(SECOND_TOKEN);

      expect(calls).toEqual([
        `handleOf(${USER})`,
        "begin",
        `verifyEmail(${SECOND_TOKEN})`,
        `finaliseHold(${USER}, ${NOW.toISOString()})`,
        "commit",
      ]);
    });
  });

  describe("the failure paths of #15", () => {
    it("treats a second click of a working link as already claimed, not an error", async () => {
      // Better Auth answers an already-verified address with no session, which
      // is not a failure: mail clients prefetch and people press back.
      const { finalise, dispatches } = build({
        verification: { ok: true, headers: new Headers(), signedIn: false },
      });
      await recordBothLinks(dispatches);

      const result = await finalise(SECOND_TOKEN);

      expect(result).toEqual({ state: "already-claimed", key: ICE });
    });

    it("reports an expired link with the Handle it still holds", async () => {
      // The ordinary case, not an edge case: the token lasts an hour and the
      // hold lasts a day. The page must never imply the Handle was lost, and it
      // cannot say the Handle is still theirs without knowing which Handle.
      const { finalise, dispatches, calls } = build({
        verification: { ok: false, reason: "rejected" },
      });
      await recordBothLinks(dispatches);

      const result = await finalise(SECOND_TOKEN);

      expect(result).toEqual({ state: "link-expired", key: ICE });
      expect(calls).toContain("rollback");
    });

    it("reports a hold that expired, and verifies nothing permanently", async () => {
      const { finalise, dispatches, calls } = build({
        hold: { ok: false, reason: "hold-expired" },
      });
      await recordBothLinks(dispatches);

      const result = await finalise(SECOND_TOKEN);

      expect(result).toEqual({ state: "hold-expired", key: ICE });
      // The rollback un-verifies the address, which is the right way round: an
      // Account whose hold died is one #83 deletes, and a verified Account with
      // no Handle is the state ADR-0004 decision 4 forbids.
      expect(calls).toContain("rollback");
    });

    it("answers link-unknown for a token it never issued", async () => {
      const { finalise, dispatches, calls } = build();
      await recordBothLinks(dispatches);

      const result = await finalise("a.token.nobody.issued");

      expect(result).toEqual({ state: "link-unknown" });
      // Nothing was read about a Handle and no transaction opened: there is
      // nobody to read about.
      expect(calls).toEqual([]);
    });

    it("answers link-unknown for an empty token without hashing it", async () => {
      const { finalise } = build();
      // The fingerprint of "" would be one shared value that every missing
      // token matched, so it is refused before it is taken.
      expect(await finalise("")).toEqual({ state: "link-unknown" });
    });

    it("answers link-unknown when the Account has no Handle at all", async () => {
      const { finalise, dispatches, calls } = build({ owned: undefined });
      await recordBothLinks(dispatches);

      expect(await finalise(SECOND_TOKEN)).toEqual({ state: "link-unknown" });
      expect(calls).not.toContain("begin");
    });
  });
});
