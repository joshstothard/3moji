import { createInMemoryClaimRateLimitStore } from "./in-memory-claim-rate-limit-store";

const HOUR_ONE = new Date("2026-09-13T12:00:00.000Z");
const HOUR_TWO = new Date("2026-09-13T13:00:00.000Z");

describe("createInMemoryClaimRateLimitStore", () => {
  it("counts each bucket and window separately, answering in the order asked", async () => {
    const store = createInMemoryClaimRateLimitStore();

    expect(
      await store.record(
        [
          { bucket: "client:a", windowStart: HOUR_ONE },
          { bucket: "email:b", windowStart: HOUR_ONE },
        ],
        HOUR_ONE,
      ),
    ).toEqual([1, 1]);
    expect(
      await store.record(
        [
          { bucket: "email:b", windowStart: HOUR_ONE },
          { bucket: "client:c", windowStart: HOUR_ONE },
        ],
        HOUR_ONE,
      ),
    ).toEqual([2, 1]);
  });

  it("forgets windows that started before the cut-off", async () => {
    const store = createInMemoryClaimRateLimitStore();
    await store.record(
      [{ bucket: "email:b", windowStart: HOUR_ONE }],
      HOUR_ONE,
    );

    await store.record(
      [{ bucket: "email:b", windowStart: HOUR_TWO }],
      HOUR_TWO,
    );

    expect([...store.rows.keys()]).toEqual([
      `email:b@${HOUR_TWO.toISOString()}`,
    ]);
  });

  it("refuses a record naming one bucket twice, as the real upsert does", async () => {
    const store = createInMemoryClaimRateLimitStore();

    await expect(
      store.record(
        [
          { bucket: "email:b", windowStart: HOUR_ONE },
          { bucket: "email:b", windowStart: HOUR_ONE },
        ],
        HOUR_ONE,
      ),
    ).rejects.toThrow(/distinct/);
  });
});
