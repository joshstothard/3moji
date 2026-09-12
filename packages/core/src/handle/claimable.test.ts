import { toHandleKey } from "../db/handle-key";

import { canonicalise } from "./canonicalise";
import { claimableHandle } from "./claimable";
import { RESERVED_HANDLES, type ReservedHandleList } from "./reserved-handles";

describe("claimableHandle — the domain layer, before any write", () => {
  it("admits an ordinary Handle and hands back its canonical key", () => {
    const result = claimableHandle("🍎🍌🍇");

    expect(result.ok).toBe(true);
    expect(result.ok ? result.handle.key : undefined).toBe("🍎🍌🍇");
  });

  it("admits a percent-encoded Handle, because that is what a route receives", () => {
    const result = claimableHandle(encodeURIComponent("🍎🍌🍇"));

    expect(result.ok ? result.handle.key : undefined).toBe("🍎🍌🍇");
    expect(result.ok ? result.handle.isCanonical : undefined).toBe(true);
  });

  /**
   * The four canonicalisation reasons stay four different answers rather than
   * collapsing into "invalid": a route 404s an unknown code point, 308s a
   * non-canonical spelling, and says "not claimable yet" for an unreleased
   * category. The gate passes the whole failure through.
   */
  it("passes a canonicalisation failure through unflattened", () => {
    const result = claimableHandle("🍎🍌");

    expect(result).toEqual({
      ok: false,
      reason: "not-a-handle",
      failure: { ok: false, reason: "wrong-length", length: 2 },
    });
  });

  it("refuses a Handle holding a blocked emoji", () => {
    const result = claimableHandle("🍎🔪🍌");

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.reason).toBe("reserved");
  });

  it("refuses a reserved entry", () => {
    expect(claimableHandle("🍎🍎🍎").ok).toBe(false);
    expect(claimableHandle("🎫🎫🎫").ok).toBe(false);
  });

  /**
   * A blocked emoji in an unreleased category fails canonicalisation first, so
   * the reason a caller sees is `unreleased-category`. That ordering is
   * deliberate and worth pinning: the reservation guard answers about released
   * emoji, and 🖕 is not claimable today for a reason that has nothing to do
   * with this list.
   */
  it("reports an unreleased blocked emoji as unreleased, not as reserved", () => {
    const result = claimableHandle("🖕🍎🍌");

    expect(result.ok ? undefined : result.reason).toBe("not-a-handle");
  });
});

/**
 * The acceptance criterion that the list is not retroactive.
 *
 * It holds **structurally**, not by assertion: `canonicalise` and `toHandleKey`
 * never consult the reserved list, so the only path that reads it is the claim
 * gate. Reserving a Handle somebody already owns therefore cannot orphan it —
 * their key still resolves, their Profile still renders, and their URL is
 * unchanged. Taking a claimed Handle away needs a deliberate takedown, not a
 * list edit ([#18](https://github.com/joshstothard/3moji/issues/18)).
 */
describe("an addition applies to future Claims only", () => {
  const claimed = "🍌🍌🍇";

  /** The list as it would read *after* a case-by-case addition. */
  const afterAddition: ReservedHandleList = {
    blocked: RESERVED_HANDLES.blocked,
    entries: [
      ...RESERVED_HANDLES.entries,
      {
        key: claimed,
        scope: "brand",
        why: "reported after the Handle was already claimed",
      },
    ],
  };

  it("was claimable before the addition", () => {
    expect(claimableHandle(claimed).ok).toBe(true);
  });

  it("is refused to a new claimant after the addition", () => {
    expect(claimableHandle(claimed, afterAddition).ok).toBe(false);
  });

  it("still resolves for the Account that already owns it", () => {
    const result = canonicalise(claimed);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.key : undefined).toBe(claimed);
    expect(result.ok ? result.encoded : undefined).toBe(
      encodeURIComponent(claimed),
    );
  });

  /**
   * And the write path still accepts the key it already stored. Were the guard
   * wired into `toHandleKey`, a later addition would make the owner's own row
   * unwritable — which is the orphaning ADR-0004 refuses.
   */
  it("still yields the same canonical key to the write path", () => {
    expect(toHandleKey(claimed)).toBe(claimed);
  });
});
