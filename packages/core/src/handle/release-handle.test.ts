import { toHandleKey, type HandleKey } from "../db/handle-key";
import type { Clock } from "../ports/clock";
import type {
  ReleasedHandle,
  ReleaseStore,
  ReleaseTransaction,
} from "../ports/release-store";
import { releaseHandle } from "./release-handle";

const NOW = new Date("2026-09-12T12:00:00.000Z");
const fixedClock: Clock = { now: () => NOW };
const USER = "user-releasing";

/** 🧊🧊🧊 — freely claimable by ADR-0004 decision 2, so nothing else refuses it. */
function iceKey(): HandleKey {
  const key = toHandleKey("🧊🧊🧊");
  if (key === undefined) {
    throw new Error(
      "🧊🧊🧊 did not canonicalise, which the Emoji Set forbids.",
    );
  }
  return key;
}

const KEY = iceKey();

interface FakeStoreConfig {
  /** What the Account owns. `undefined` is "there is nothing to release". */
  readonly owned?: HandleKey | undefined;
}

/**
 * A {@link ReleaseStore} that records what the Release did inside its
 * transaction, **in order**, and mirrors the real adapter's contract:
 * `commit: false` rolls back.
 *
 * The call log is the assertion that matters. A result alone cannot tell a
 * Release that wrote a tombstone from one that did not, and it cannot tell a
 * key read *before* the delete from one read after — which is the ordering the
 * cascade makes load-bearing.
 */
function createFakeStore(config: FakeStoreConfig = {}) {
  const calls: string[] = [];
  const tombstones: ReleasedHandle[] = [];
  const deleted: string[] = [];

  const store: ReleaseStore = {
    async runInTransaction(work) {
      calls.push("begin");
      const tx: ReleaseTransaction = {
        handleOf(userId) {
          calls.push(`handleOf:${userId}`);
          return Promise.resolve(config.owned);
        },
        recordRelease(tombstone) {
          calls.push(`recordRelease:${tombstone.key}`);
          tombstones.push(tombstone);
          return Promise.resolve();
        },
        deleteAccount(userId) {
          calls.push(`deleteAccount:${userId}`);
          deleted.push(userId);
          return Promise.resolve();
        },
      };
      const outcome = await work(tx);
      calls.push(outcome.commit ? "commit" : "rollback");
      return outcome.value;
    },
  };

  return { store, calls, tombstones, deleted };
}

describe("releaseHandle", () => {
  it("deletes the Account and reports the Handle it released", async () => {
    const { store } = createFakeStore({ owned: KEY });

    const result = await releaseHandle({
      userId: USER,
      store,
      clock: fixedClock,
    });

    expect(result).toEqual({ state: "released", key: KEY, releasedAt: NOW });
  });

  /**
   * **ADR-0009 decision 2: the tombstone and the deletion are one act.** A
   * deletion with no tombstone loses the one fact that cannot be recreated —
   * and the write must happen *inside* the transaction, which the log shows by
   * sitting between `begin` and `commit`.
   */
  it("writes the tombstone and deletes the Account in one committed transaction", async () => {
    const { store, calls, deleted } = createFakeStore({ owned: KEY });

    await releaseHandle({ userId: USER, store, clock: fixedClock });

    expect(calls).toEqual([
      "begin",
      `handleOf:${USER}`,
      `recordRelease:${KEY}`,
      `deleteAccount:${USER}`,
      "commit",
    ]);
    expect(deleted).toEqual([USER]);
  });

  /**
   * **The key is read before the delete, and that ordering is a rule rather
   * than a preference.** `handle.user_id` cascades from `user`, so a read
   * placed after the deletion finds nothing and the tombstone would carry no
   * key at all. The log above pins the order; this pins what it produced.
   */
  it("records the canonical key and the injected time, and nothing else", async () => {
    const { store, tombstones } = createFakeStore({ owned: KEY });

    await releaseHandle({ userId: USER, store, clock: fixedClock });

    expect(tombstones).toHaveLength(1);
    // The whole object, not a field-by-field check: a `userId` added to the
    // tombstone later is exactly the failure decision 3 forbids, and only an
    // exhaustive assertion goes red for it.
    expect(tombstones[0]).toEqual({ key: KEY, releasedAt: NOW });
  });

  /** Time comes from the injected `Clock` — the one place it is read here. */
  it("times the release by the injected Clock rather than the system one", async () => {
    const later = new Date("2027-01-01T00:00:00.000Z");
    const { store, tombstones } = createFakeStore({ owned: KEY });

    await releaseHandle({
      userId: USER,
      store,
      clock: { now: () => later },
    });

    expect(tombstones[0]?.releasedAt).toEqual(later);
  });

  /**
   * Nothing to release: no live Account owns a Handle under this id. ADR-0004
   * decision 4 says a live Account always owns exactly one, so this is either
   * an id that names nobody or a Release that already happened — and in both
   * cases the honest answer is to write nothing and delete nothing.
   */
  it("writes no tombstone and deletes nothing when the Account owns no Handle", async () => {
    const { store, calls, tombstones, deleted } = createFakeStore({
      owned: undefined,
    });

    const result = await releaseHandle({
      userId: USER,
      store,
      clock: fixedClock,
    });

    expect(result).toEqual({ state: "no-handle" });
    expect(calls).toEqual(["begin", `handleOf:${USER}`, "rollback"]);
    expect(tombstones).toEqual([]);
    expect(deleted).toEqual([]);
  });
});
