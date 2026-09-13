import { toHandleKey, type HandleKey } from "../db/handle-key";
import type { OwnedHandle } from "../ports/account-directory";
import { profileEditAuthority } from "./profile-authority";

function keyOf(handle: string): HandleKey {
  const key = toHandleKey(handle);
  if (key === undefined) {
    throw new Error(`${handle} did not canonicalise, which the test relies on`);
  }
  return key;
}

/** 🧊🧊🧊 — the Handle being edited. */
const ICE = keyOf("\u{1F9CA}\u{1F9CA}\u{1F9CA}");
/** 🎈🎈🎈 — somebody else's Handle entirely. */
const BALLOON = keyOf("\u{1F388}\u{1F388}\u{1F388}");

const CLAIMED_AT = new Date("2026-09-01T00:00:00.000Z");
const HELD_UNTIL = new Date("2026-09-02T00:00:00.000Z");

const owning = (key: HandleKey): OwnedHandle => ({
  key,
  heldUntil: HELD_UNTIL,
  claimedAt: CLAIMED_AT,
});

describe("profileEditAuthority", () => {
  it("lets the owner of the claimed Handle edit it, and names the row to write", () => {
    expect(
      profileEditAuthority({
        viewer: { userId: "owner-1" },
        owned: owning(ICE),
        requested: ICE,
      }),
    ).toEqual({ state: "allowed", userId: "owner-1" });
  });

  it("refuses a signed-out visitor", () => {
    expect(
      profileEditAuthority({
        viewer: undefined,
        owned: undefined,
        requested: ICE,
      }),
    ).toEqual({ state: "signed-out" });
  });

  /**
   * **The case an authorisation bug actually reaches.** A signed-out visitor is
   * refused by the first guard anyone writes; somebody signed in, with a live
   * Account and a Handle of their own, is refused only by comparing the Handle
   * in the request against the one the session owns.
   */
  it("refuses a signed-in visitor who owns a different Handle", () => {
    expect(
      profileEditAuthority({
        viewer: { userId: "owner-of-balloons" },
        owned: owning(BALLOON),
        requested: ICE,
      }),
    ).toEqual({ state: "not-owner" });
  });

  it("refuses an Account that owns no Handle at all", () => {
    expect(
      profileEditAuthority({
        viewer: { userId: "handle-less" },
        owned: undefined,
        requested: ICE,
      }),
    ).toEqual({ state: "no-handle" });
  });

  /**
   * A hold is not ownership. `claimed_at` is what ownership means (ADR-0004),
   * and `profileStateOf` refuses to publish a Profile for anything but
   * `claimed` — so a Profile written from a hold is a row no reader can ever
   * see, written by somebody whose email is not yet verified.
   */
  it("refuses a holder whose Claim is not final", () => {
    expect(
      profileEditAuthority({
        viewer: { userId: "still-holding" },
        owned: { key: ICE, heldUntil: HELD_UNTIL, claimedAt: null },
        requested: ICE,
      }),
    ).toEqual({ state: "not-claimed" });
  });

  /**
   * The refusals are ordered so the answer is about the **viewer's own
   * standing** before it is about the Handle they asked for: somebody still
   * holding 🧊🧊🧊 who asks to edit 🎈🎈🎈 is told their Claim is unfinished,
   * which is the thing they can act on.
   */
  it("reports an unfinished Claim ahead of the wrong Handle", () => {
    expect(
      profileEditAuthority({
        viewer: { userId: "still-holding" },
        owned: { key: ICE, heldUntil: HELD_UNTIL, claimedAt: null },
        requested: BALLOON,
      }),
    ).toEqual({ state: "not-claimed" });
  });
});
