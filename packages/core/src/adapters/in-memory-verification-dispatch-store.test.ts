import { createInMemoryVerificationDispatchStore } from "./in-memory-verification-dispatch-store";

const USER = "user-1";
const OTHER = "user-2";
const at = (iso: string): Date => new Date(iso);

describe("createInMemoryVerificationDispatchStore", () => {
  it("answers newestFor with the newest link, whatever order rows arrived in", async () => {
    // The fake must match the adapter's ordering promise. A fake that is laxer
    // than its adapter turns a green unit test into a production defect.
    const store = createInMemoryVerificationDispatchStore();
    await store.record({
      userId: USER,
      tokenHash: "older",
      sentAt: at("2026-09-12T11:00:00.000Z"),
    });
    await store.record({
      userId: USER,
      tokenHash: "newest",
      sentAt: at("2026-09-12T11:59:00.000Z"),
    });
    await store.record({
      userId: USER,
      tokenHash: "middle",
      sentAt: at("2026-09-12T11:30:00.000Z"),
    });

    expect((await store.newestFor(USER))?.tokenHash).toBe("newest");
  });

  it("keeps one Account's links out of another's", async () => {
    const store = createInMemoryVerificationDispatchStore();
    await store.record({
      userId: OTHER,
      tokenHash: "theirs",
      sentAt: at("2026-09-12T11:59:00.000Z"),
    });

    expect(await store.newestFor(USER)).toBeUndefined();
    expect(await store.since(USER, at("2026-09-12T00:00:00.000Z"))).toEqual([]);
  });

  it("includes a link sent exactly at the window boundary", async () => {
    const store = createInMemoryVerificationDispatchStore();
    await store.record({
      userId: USER,
      tokenHash: "boundary",
      sentAt: at("2026-09-12T11:00:00.000Z"),
    });

    const rows = await store.since(USER, at("2026-09-12T11:00:00.000Z"));

    expect(rows).toHaveLength(1);
  });

  it("finds a link by its fingerprint", async () => {
    const store = createInMemoryVerificationDispatchStore();
    await store.record({
      userId: USER,
      tokenHash: "abc",
      sentAt: at("2026-09-12T11:00:00.000Z"),
    });

    expect((await store.findByTokenHash("abc"))?.userId).toBe(USER);
    expect(await store.findByTokenHash("nope")).toBeUndefined();
  });

  it("answers the newest match for a fingerprint recorded twice", async () => {
    // Reachable in principle: Better Auth's JWT carries `iat` at one-second
    // resolution and no nonce, so two links signed for one address inside one
    // second are byte-identical — which is why the column is not UNIQUE.
    const store = createInMemoryVerificationDispatchStore();
    await store.record({
      userId: USER,
      tokenHash: "same",
      sentAt: at("2026-09-12T11:00:00.000Z"),
    });
    await store.record({
      userId: USER,
      tokenHash: "same",
      sentAt: at("2026-09-12T11:00:01.000Z"),
    });

    expect((await store.findByTokenHash("same"))?.sentAt.toISOString()).toBe(
      "2026-09-12T11:00:01.000Z",
    );
  });

  it("clears, so one suite's rows do not become another's", async () => {
    const store = createInMemoryVerificationDispatchStore();
    await store.record({
      userId: USER,
      tokenHash: "abc",
      sentAt: at("2026-09-12T11:00:00.000Z"),
    });

    store.clear();

    expect(store.recorded).toEqual([]);
  });
});
