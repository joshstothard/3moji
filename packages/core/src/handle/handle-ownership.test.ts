import { ownershipOf, type HandleHoldRow } from "./handle-ownership";

const at = (iso: string): Date => new Date(iso);
const NOW = at("2026-09-12T12:00:00.000Z");

describe("ownershipOf", () => {
  it("reports a key with no row as available", () => {
    expect(ownershipOf(undefined, NOW)).toBe("available");
  });

  it("reports a live hold as held", () => {
    const row: HandleHoldRow = {
      heldUntil: at("2026-09-13T12:00:00.000Z"),
      claimedAt: null,
    };
    expect(ownershipOf(row, NOW)).toBe("held");
  });

  it("reports a claimed Handle as claimed", () => {
    const row: HandleHoldRow = {
      heldUntil: at("2026-09-13T12:00:00.000Z"),
      claimedAt: at("2026-09-12T11:00:00.000Z"),
    };
    expect(ownershipOf(row, NOW)).toBe("claimed");
  });

  // The criterion this issue exists for: a hold past its expiry is
  // indistinguishable from a free Handle to a would-be claimant.
  it("reports an expired hold as available", () => {
    const row: HandleHoldRow = {
      heldUntil: at("2026-09-11T12:00:00.000Z"),
      claimedAt: null,
    };
    expect(ownershipOf(row, NOW)).toBe("available");
  });

  it("holds one second before expiry and frees one second after", () => {
    const heldUntil = at("2026-09-12T12:00:01.000Z");
    expect(ownershipOf({ heldUntil, claimedAt: null }, NOW)).toBe("held");
    const expired = at("2026-09-12T11:59:59.000Z");
    expect(ownershipOf({ heldUntil: expired, claimedAt: null }, NOW)).toBe(
      "available",
    );
  });

  it("treats the expiry instant itself as expired", () => {
    expect(ownershipOf({ heldUntil: NOW, claimedAt: null }, NOW)).toBe(
      "available",
    );
  });

  // `claimed_at IS NULL` is what "still held" means, so a claimed row whose
  // held_until has long passed is owned — not expired. Reading the timestamp
  // alone would silently free somebody's Handle.
  it("never frees a claimed Handle, whatever held_until says", () => {
    const row: HandleHoldRow = {
      heldUntil: at("2020-01-01T00:00:00.000Z"),
      claimedAt: at("2020-01-01T00:00:00.000Z"),
    };
    expect(ownershipOf(row, NOW)).toBe("claimed");
  });
});
