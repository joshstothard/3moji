import type { Clock } from "../ports/clock";
import type {
  AccountCreated,
  ClaimStore,
  ExpiredHoldFreed,
  HoldWritten,
} from "../ports/claim-store";
import { claimHandle, HOLD_DURATION_MS } from "./claim-handle";
import type { HandleOwnership } from "./handle-ownership";
import type {
  ReservedHandleEntry,
  ReservedHandleList,
} from "./reserved-handles";

const NOW = new Date("2026-09-12T12:00:00.000Z");
const fixedClock = (now: Date = NOW): Clock => ({ now: () => now });

// 🧊🧊🧊 — freely claimable by ADR-0004 decision 2, and deliberately not reserved.
const ICE = "🧊🧊🧊";
// 🍕🍕🍕 — a platform-owned Reserved entry in the shipped list.
const PIZZA = "🍕🍕🍕";

const EMAIL = "claimant@example.com";
const PASSWORD = "correct horse battery staple";

interface FakeStoreConfig {
  readonly ownership?: HandleOwnership;
  readonly account?: AccountCreated;
  readonly hold?: HoldWritten;
  /** What the expired-hold write reports. Defaults to "there was nothing". */
  readonly freed?: ExpiredHoldFreed;
  /** Runs the instant the transaction opens, before the work does anything. */
  readonly onOpen?: () => void;
}

/**
 * A {@link ClaimStore} that records what the Claim did inside its transaction,
 * in order, and mirrors the real adapter's contract: `commit: false` rolls back.
 *
 * The call log is the assertion that matters for "nothing was created" — a
 * result alone cannot tell a rejection that wrote nothing from one that wrote
 * and rolled back, and only one of those is what ADR-0004 decision 4 promises.
 */
const createFakeStore = (config: FakeStoreConfig = {}) => {
  const calls: string[] = [];

  const store: ClaimStore = {
    async runInTransaction(work) {
      calls.push("begin");
      config.onOpen?.();
      const outcome = await work({
        availabilityOf: (key, now) => {
          calls.push(`availabilityOf(${key}, ${now.toISOString()})`);
          return Promise.resolve(config.ownership ?? "available");
        },
        freeExpiredHold: (key, now) => {
          calls.push(`freeExpiredHold(${key}, ${now.toISOString()})`);
          return Promise.resolve(config.freed ?? { freed: false });
        },
        createAccount: (account) => {
          calls.push(`createAccount(${account.email}, ${account.name})`);
          return Promise.resolve(
            config.account ?? { ok: true, userId: "user-1" },
          );
        },
        holdHandle: (hold) => {
          calls.push(
            `holdHandle(${hold.key}, ${hold.userId}, ${hold.heldUntil.toISOString()})`,
          );
          return Promise.resolve(config.hold ?? { ok: true });
        },
      });
      calls.push(outcome.commit ? "commit" : "rollback");
      return outcome.value;
    },
  };

  return { store, calls };
};

/**
 * A Reserved Handle list whose entries can change **after** it is handed over.
 *
 * `entries` is a getter, so every read is a fresh one. That is what makes the
 * in-transaction re-check provable rather than asserted: a list read once,
 * before the transaction opened, cannot see a change made after it opened, and
 * an implementation that hoists the call out of the callback therefore fails
 * the test below while passing every other test in this file.
 */
const flippableList = (entry: ReservedHandleEntry) => {
  let entries: readonly ReservedHandleEntry[] = [];
  const list: ReservedHandleList = {
    blocked: [],
    get entries() {
      return entries;
    },
  };
  return { list, reserve: () => (entries = [entry]) };
};

const reservedEntry = (key: string): ReservedHandleEntry => ({
  key,
  scope: "platform",
  why: "reserved mid-flight by this test",
});

const claim = (overrides: {
  segment?: string;
  store: ClaimStore;
  list?: ReservedHandleList;
  clock?: Clock;
  email?: string;
}) =>
  claimHandle({
    segment: overrides.segment ?? ICE,
    email: overrides.email ?? EMAIL,
    password: PASSWORD,
    store: overrides.store,
    clock: overrides.clock ?? fixedClock(),
    ...(overrides.list === undefined ? {} : { list: overrides.list }),
  });

describe("claimHandle", () => {
  it("creates the Account and holds the Handle in one committed transaction", async () => {
    const { store, calls } = createFakeStore();

    const result = await claim({ store });

    expect(result.state).toBe("held");
    expect(calls).toEqual([
      "begin",
      `availabilityOf(${ICE}, ${NOW.toISOString()})`,
      `freeExpiredHold(${ICE}, ${NOW.toISOString()})`,
      `createAccount(${EMAIL}, ${ICE})`,
      `holdHandle(${ICE}, user-1, 2026-09-13T12:00:00.000Z)`,
      "commit",
    ]);
  });

  it("holds the Handle for 24 hours from the injected clock", async () => {
    const { store } = createFakeStore();
    const now = new Date("2001-02-03T04:05:06.000Z");

    const result = await claim({ store, clock: fixedClock(now) });

    if (result.state !== "held") throw new Error(`got ${result.state}`);
    expect(result.heldUntil.toISOString()).toBe("2001-02-04T04:05:06.000Z");
    expect(result.heldUntil.getTime() - now.getTime()).toBe(HOLD_DURATION_MS);
  });

  it("never opens a transaction for something that is not a Handle", async () => {
    const { store, calls } = createFakeStore();

    const result = await claim({ segment: "abc", store });

    expect(result.state).toBe("not-a-handle");
    if (result.state !== "not-a-handle") throw new Error("narrowing");
    expect(result.failure.reason).toBe("unknown-codepoint");
    expect(calls).toEqual([]);
  });

  it("refuses a Reserved Handle in the domain, before anything opens", async () => {
    const { store, calls } = createFakeStore();

    const result = await claim({ segment: PIZZA, store });

    if (result.state !== "not-claimable")
      throw new Error(`got ${result.state}`);
    expect(result.caughtBy).toBe("domain");
    expect(result.reservation.kind).toBe("reserved-entry");
    expect(result.handle.key).toBe(PIZZA);
    expect(calls).toEqual([]);
  });

  /**
   * **ADR-0004 decision 7's middle layer, and the reason this issue exists.**
   *
   * The Handle becomes Reserved *after* the transaction opens — which is after
   * the point a naive implementation would have read the list, and before the
   * insert the read is supposed to guard. An implementation that consults the
   * list only before `runInTransaction` sees an empty list, proceeds, and
   * writes the hold; this test is the only one in the file that can tell the
   * difference.
   */
  it("re-reads the Reserved list inside the transaction, so a reservation made after it opened still refuses the Claim", async () => {
    const { list, reserve } = flippableList(reservedEntry(ICE));
    const { store, calls } = createFakeStore({ onOpen: reserve });

    const result = await claim({ store, list });

    if (result.state !== "not-claimable")
      throw new Error(`got ${result.state}`);
    expect(result.caughtBy).toBe("transaction");
    expect(result.reservation.kind).toBe("reserved-entry");
    // Nothing was read and nothing was written: the re-check is the first thing
    // inside the transaction, and the transaction rolled back.
    expect(calls).toEqual(["begin", "rollback"]);
  });

  it("still claims a Handle when the list changes to something else mid-flight", async () => {
    // The other half of the layer: a re-check that refused everything would
    // pass the test above and break the product.
    const { list, reserve } = flippableList(reservedEntry(PIZZA));
    const { store, calls } = createFakeStore({ onOpen: reserve });

    const result = await claim({ store, list });

    expect(result.state).toBe("held");
    expect(calls).toContain("commit");
  });

  it.each([
    { ownership: "held" as const, because: "held" },
    { ownership: "claimed" as const, because: "claimed" },
  ])(
    "creates nothing when the in-transaction read finds the Handle $ownership",
    async ({ ownership, because }) => {
      const { store, calls } = createFakeStore({ ownership });

      const result = await claim({ store });

      if (result.state !== "taken") throw new Error(`got ${result.state}`);
      expect(result.because).toBe(because);
      expect(calls).toEqual([
        "begin",
        `availabilityOf(${ICE}, ${NOW.toISOString()})`,
        "rollback",
      ]);
    },
  );

  /**
   * A Handle taken between picking and submitting: the primary key rejects the
   * insert and **nothing is created**, because the Account and the hold are one
   * act. The same answer covers an expired hold whose row nothing has freed —
   * that write is [#83](https://github.com/joshstothard/3moji/issues/83)'s, and
   * this path only tolerates the row.
   */
  it("creates nothing when the primary key rejects the hold after an available read", async () => {
    const { store, calls } = createFakeStore({
      hold: { ok: false, reason: "key-taken" },
    });

    const result = await claim({ store });

    if (result.state !== "taken") throw new Error(`got ${result.state}`);
    expect(result.because).toBe("write-rejected");
    expect(calls.at(-1)).toBe("rollback");
    expect(calls).toContain(`createAccount(${EMAIL}, ${ICE})`);
  });

  /**
   * #15's already-registered path. The domain says what happened — it has to,
   * or #82 cannot send the existing address the "someone tried to sign up"
   * email — and **nothing is written**: no second Account, and no hold that
   * would take a Handle away from the person submitting.
   */
  it("creates nothing and holds nothing when the email is already registered", async () => {
    const { store, calls } = createFakeStore({
      account: { ok: false, reason: "email-taken" },
    });

    const result = await claim({ store });

    expect(result.state).toBe("already-registered");
    expect(calls).toEqual([
      "begin",
      `availabilityOf(${ICE}, ${NOW.toISOString()})`,
      `freeExpiredHold(${ICE}, ${NOW.toISOString()})`,
      `createAccount(${EMAIL}, ${ICE})`,
      "rollback",
    ]);
  });

  /**
   * **ADR-0004 decision 3's write side, and the ordering is the rule.**
   *
   * Expiry is lazy: nothing sweeps, so the only moment an expired hold can be
   * freed is the moment someone next attempts the Handle — inside this
   * transaction. The freeing write must come **before** `createAccount`,
   * because freeing the Handle is deleting the unverified Account (decision
   * 5), and that Account may hold the very email address being submitted. A
   * `createAccount` that ran first would read the doomed row and answer
   * `already-registered`, so the same person could never reclaim their own
   * expired hold.
   */
  it("frees an expired hold before creating the Account, so the same address can reclaim it", async () => {
    const { store, calls } = createFakeStore({ freed: { freed: true } });

    const result = await claim({ store });

    expect(result.state).toBe("held");
    const freeAt = calls.indexOf(
      `freeExpiredHold(${ICE}, ${NOW.toISOString()})`,
    );
    const createAt = calls.indexOf(`createAccount(${EMAIL}, ${ICE})`);
    expect(freeAt).toBeGreaterThan(-1);
    // Named rather than asserted as a bare ordering: a reorder that put
    // createAccount first would make the same-address reclaim impossible.
    expect({ freeExpiredHold: freeAt, createAccount: createAt }).toEqual({
      freeExpiredHold: 2,
      createAccount: 3,
    });
    expect(calls.at(-1)).toBe("commit");
  });

  it("passes the availability read and the freeing write the same instant", async () => {
    const now = new Date("2001-02-03T04:05:06.000Z");
    const { store, calls } = createFakeStore({ freed: { freed: true } });

    await claim({ store, clock: fixedClock(now) });

    // One `now` for both, or a row could read as expired and then fail to
    // match the predicate that deletes it.
    expect(calls).toContain(`availabilityOf(${ICE}, ${now.toISOString()})`);
    expect(calls).toContain(`freeExpiredHold(${ICE}, ${now.toISOString()})`);
  });

  /**
   * The other half: a Handle that is genuinely held or genuinely claimed is
   * never offered to the freeing write at all. A verified Account's Handle must
   * never be freed whatever `held_until` says, and the first defence is simply
   * not asking.
   */
  it.each([{ ownership: "held" as const }, { ownership: "claimed" as const }])(
    "never attempts to free a Handle the read found $ownership",
    async ({ ownership }) => {
      const { store, calls } = createFakeStore({ ownership });

      await claim({ store });

      expect(
        calls.filter((call) => call.startsWith("freeExpiredHold")),
      ).toEqual([]);
    },
  );

  it("reads time once, so the hold and the availability read agree about now", async () => {
    let reads = 0;
    const countingClock: Clock = {
      now: () => {
        reads += 1;
        return NOW;
      },
    };
    const { store } = createFakeStore();

    await claim({ store, clock: countingClock });

    expect(reads).toBe(1);
  });
});
