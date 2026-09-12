import type { Clock } from "../ports/clock";
import type { HandleRepository } from "../ports/handle-repository";
import type { HandleKey } from "../db/handle-key";
import { handleAvailability } from "./handle-availability";
import type { HandleOwnership } from "./handle-ownership";
import { ownershipOf, type HandleHoldRow } from "./handle-ownership";
import { RESERVED_HANDLES } from "./reserved-handles";

const NOW = new Date("2026-09-12T12:00:00.000Z");
const fixedClock = (now: Date = NOW): Clock => ({ now: () => now });

/** A repository that answers from an in-memory row, through the real rule. */
const repositoryWith = (
  rows: ReadonlyMap<string, HandleHoldRow>,
): HandleRepository => ({
  availabilityOf: (key: HandleKey, now: Date): Promise<HandleOwnership> =>
    Promise.resolve(ownershipOf(rows.get(key), now)),
});

const empty = repositoryWith(new Map());

// 🧊🧊🧊 — freely claimable by ADR-0004 decision 2, and deliberately not reserved.
const ICE = "🧊🧊🧊";
// 🍕🍕🍕 — a platform-owned Reserved entry.
const PIZZA = "🍕🍕🍕";
// 🔪🔪🔪 — a blocked emoji, in a released category so it is reachable.
const KNIFE = "🔪🔪🔪";

describe("handleAvailability", () => {
  it("reports a free Handle as available", async () => {
    const result = await handleAvailability({
      segment: ICE,
      repository: empty,
      clock: fixedClock(),
    });
    expect(result.state).toBe("available");
  });

  it("passes a segment that is not a Handle straight through", async () => {
    const result = await handleAvailability({
      segment: "abc",
      repository: empty,
      clock: fixedClock(),
    });
    expect(result.state).toBe("not-a-handle");
    if (result.state !== "not-a-handle") throw new Error("narrowing");
    expect(result.failure.reason).toBe("unknown-codepoint");
  });

  it("reports a held Handle as held", async () => {
    const rows = new Map([
      [
        ICE,
        { heldUntil: new Date("2026-09-13T12:00:00.000Z"), claimedAt: null },
      ],
    ]);
    const result = await handleAvailability({
      segment: ICE,
      repository: repositoryWith(rows),
      clock: fixedClock(),
    });
    expect(result.state).toBe("held");
  });

  it("reports a claimed Handle as claimed", async () => {
    const rows = new Map([
      [
        ICE,
        {
          heldUntil: new Date("2026-09-13T12:00:00.000Z"),
          claimedAt: new Date("2026-09-12T09:00:00.000Z"),
        },
      ],
    ]);
    const result = await handleAvailability({
      segment: ICE,
      repository: repositoryWith(rows),
      clock: fixedClock(),
    });
    expect(result.state).toBe("claimed");
  });

  // AC5: time is driven through the injected Clock, with no database.
  it("frees an expired hold when the clock moves past it", async () => {
    const rows = new Map([
      [
        ICE,
        { heldUntil: new Date("2026-09-12T12:00:00.000Z"), claimedAt: null },
      ],
    ]);
    const repository = repositoryWith(rows);

    const before = await handleAvailability({
      segment: ICE,
      repository,
      clock: fixedClock(new Date("2026-09-12T11:59:59.000Z")),
    });
    expect(before.state).toBe("held");

    const after = await handleAvailability({
      segment: ICE,
      repository,
      clock: fixedClock(new Date("2026-09-12T12:00:01.000Z")),
    });
    expect(after.state).toBe("available");
  });

  // AC4: not-claimable must be distinguishable from claimed. Collapsing them
  // is the #68 defect in another form.
  it("reports a Reserved entry as not-claimable, not as claimed", async () => {
    const result = await handleAvailability({
      segment: PIZZA,
      repository: empty,
      clock: fixedClock(),
    });
    expect(result.state).toBe("not-claimable");
    if (result.state !== "not-claimable") throw new Error("narrowing");
    // Reservation is a discriminated union, so the kind is the assertion that
    // distinguishes a Reserved entry from a blocked emoji.
    expect(result.reservation.kind).toBe("reserved-entry");
    if (result.reservation.kind !== "reserved-entry") throw new Error("kind");
    expect(result.reservation.entry.scope).toBe("platform");
  });

  it("reports a blocked emoji as not-claimable", async () => {
    const result = await handleAvailability({
      segment: KNIFE,
      repository: empty,
      clock: fixedClock(),
    });
    expect(result.state).toBe("not-claimable");
    if (result.state !== "not-claimable") throw new Error("narrowing");
    expect(result.reservation.kind).toBe("blocked-emoji");
    if (result.reservation.kind !== "blocked-emoji") throw new Error("kind");
    expect(result.reservation.emoji.emoji).toBe("🔪");
  });

  // An unreleased category is a different answer from a reservation: 🖕 is
  // unclaimable for a reason that has nothing to do with the Reserved list.
  it("reports an unreleased category as not-a-handle, not as not-claimable", async () => {
    const result = await handleAvailability({
      segment: "😀😀😀",
      repository: empty,
      clock: fixedClock(),
    });
    expect(result.state).toBe("not-a-handle");
    if (result.state !== "not-a-handle") throw new Error("narrowing");
    expect(result.failure.reason).toBe("unreleased-category");
  });

  // The precedence question. Reserved additions apply to future Claims only
  // (ADR-0004 / #52), so an owner keeps a Handle that was reserved after they
  // claimed it — and "claimed" is the truthful answer for a visitor, because a
  // Profile is there to see.
  it("prefers claimed over not-claimable when a Reserved Handle is already owned", async () => {
    const rows = new Map([
      [
        PIZZA,
        {
          heldUntil: new Date("2026-09-13T12:00:00.000Z"),
          claimedAt: new Date("2026-09-01T09:00:00.000Z"),
        },
      ],
    ]);
    const result = await handleAvailability({
      segment: PIZZA,
      repository: repositoryWith(rows),
      clock: fixedClock(),
    });
    expect(result.state).toBe("claimed");
  });

  it("takes the Reserved list as a parameter so a test can add an entry", async () => {
    const result = await handleAvailability({
      segment: ICE,
      repository: empty,
      clock: fixedClock(),
      list: {
        ...RESERVED_HANDLES,
        entries: [
          ...RESERVED_HANDLES.entries,
          { key: ICE, scope: "platform", why: "test-only addition" },
        ],
      },
    });
    expect(result.state).toBe("not-claimable");
  });

  it("carries the canonical handle so a caller need not canonicalise twice", async () => {
    const result = await handleAvailability({
      segment: ICE,
      repository: empty,
      clock: fixedClock(),
    });
    if (result.state === "not-a-handle") throw new Error("narrowing");
    expect(result.handle.key).toBe(ICE);
  });

  it("gives the held answer nowhere to carry the holder or the expiry", async () => {
    // ADR-0004: a countdown is an information leak and an invitation to wait,
    // and "we simply do not render it" is a promise one careless JSX edit
    // breaks. The guarantee asserted here is structural instead — the `held`
    // result has two fields, neither of which is a time or a person, so
    // leaking either would require widening this type in `packages/core` and
    // turning this test red on the way.
    const rows = new Map([
      [
        ICE,
        { heldUntil: new Date("2026-09-13T12:00:00.000Z"), claimedAt: null },
      ],
    ]);

    const result = await handleAvailability({
      segment: ICE,
      repository: repositoryWith(rows),
      clock: fixedClock(),
    });

    expect(result.state).toBe("held");
    expect(Object.keys(result).sort()).toEqual(["handle", "state"]);
    if (result.state !== "held") throw new Error("narrowing");
    expect(Object.keys(result.handle).sort()).toEqual([
      "emoji",
      "encoded",
      "isCanonical",
      "key",
      "ok",
    ]);
    expect(JSON.stringify(result)).not.toContain("2026-09-13");
  });
});
