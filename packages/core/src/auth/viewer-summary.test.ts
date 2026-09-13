import { toHandleKey, type HandleKey } from "../db/handle-key";
import type { OwnedHandle } from "../ports/account-directory";
import { viewerSummary } from "./viewer-summary";

/**
 * What the signed-in indicator is told about the person looking at it
 * ([#193](https://github.com/joshstothard/3moji/issues/193)).
 *
 * Written from the acceptance criteria before the function existed: an owner
 * is shown their own Profile and edit links, a signed-out visitor is shown
 * nobody's, and nothing but a claimed Handle is ever linked.
 */

function keyOf(handle: string): HandleKey {
  const key = toHandleKey(handle);
  if (key === undefined) {
    throw new Error(`${handle} did not canonicalise, which the test relies on`);
  }
  return key;
}

const ICE = keyOf("\u{1F9CA}\u{1F9CA}\u{1F9CA}");
const ICE_ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";
const VIEWER = { userId: "owner-1" };

const claimed = (key: HandleKey): OwnedHandle => ({
  key,
  heldUntil: new Date("2026-09-02T00:00:00.000Z"),
  claimedAt: new Date("2026-09-01T00:00:00.000Z"),
});

const held = (key: HandleKey): OwnedHandle => ({
  key,
  heldUntil: new Date("2999-01-01T00:00:00.000Z"),
  claimedAt: null,
});

describe("viewerSummary", () => {
  it("answers signed-out when there is no session", () => {
    expect(viewerSummary({ viewer: undefined, owned: undefined })).toEqual({
      state: "signed-out",
    });
  });

  it("answers signed-out without a session even if a Handle is somehow supplied", () => {
    // Nothing about a Handle may reach somebody the session does not name.
    expect(viewerSummary({ viewer: undefined, owned: claimed(ICE) })).toEqual({
      state: "signed-out",
    });
  });

  it("names the owner's claimed Handle, as its key and its percent-encoded path", () => {
    expect(viewerSummary({ viewer: VIEWER, owned: claimed(ICE) })).toEqual({
      state: "owner",
      key: ICE,
      encoded: ICE_ENCODED,
    });
  });

  it("answers signed-in, with no Handle, for an Account the directory found nothing for", () => {
    expect(viewerSummary({ viewer: VIEWER, owned: undefined })).toEqual({
      state: "signed-in",
    });
  });

  it("links no Profile for a hold that is not yet final, because a hold is not ownership", () => {
    expect(viewerSummary({ viewer: VIEWER, owned: held(ICE) })).toEqual({
      state: "signed-in",
    });
  });

  it("never carries the user id or the Handle's dates", () => {
    const summary = viewerSummary({ viewer: VIEWER, owned: claimed(ICE) });

    expect(JSON.stringify(summary)).not.toContain(VIEWER.userId);
    expect(Object.keys(summary).sort()).toEqual(["encoded", "key", "state"]);
  });
});
