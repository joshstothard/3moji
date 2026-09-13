import { createDatabase } from "../db/client";
import {
  createDrizzleProfileStore,
  linkRowsFor,
  profileTransactionOn,
} from "./drizzle-profile-store";

/**
 * A URL is required to build a client, but **nothing here connects**: the port
 * is closed on purpose, and a refused connection is exactly the behaviour under
 * test. The behaviour against a database that answers is
 * `db/profile.integration.test.ts`'s, in CI.
 */
const URL = "postgresql://app:app@127.0.0.1:59999/app_test";

/** The `message` of an unknown rejection, without `instanceof`. */
const messageOf = (error: unknown): string =>
  typeof error === "object" &&
  error !== null &&
  "message" in error &&
  typeof error.message === "string"
    ? error.message
    : `not an error: ${String(error)}`;

const causeOf = (error: unknown): unknown =>
  typeof error === "object" && error !== null && "cause" in error
    ? error.cause
    : undefined;

/**
 * Every message down an unknown rejection's `cause` chain, joined. Drizzle
 * reports a failed statement as "Failed query: …" and keeps the driver's own
 * error — the one carrying `ECONNREFUSED` — in `cause`.
 */
const messagesOf = (error: unknown, depth = 0): string =>
  depth > 8
    ? ""
    : `${messageOf(error)} ${
        causeOf(error) === undefined
          ? ""
          : messagesOf(causeOf(error), depth + 1)
      }`;

describe("linkRowsFor", () => {
  /**
   * **The array's order becomes `position`, densely from zero.** This is the
   * whole translation from "the order the owner set" to the column a read
   * orders by, and it is the half of the write that can be proved without a
   * database.
   */
  it("numbers the submitted list from zero, in order", () => {
    let next = 0;
    const rows = linkRowsFor(
      "owner-1",
      [
        { title: "First", url: "https://a.example" },
        { title: "Second", url: "https://b.example" },
        { title: "Third", url: "https://c.example" },
      ],
      () => `id-${String(next++)}`,
    );

    expect(rows).toEqual([
      {
        id: "id-0",
        userId: "owner-1",
        title: "First",
        url: "https://a.example",
        position: 0,
      },
      {
        id: "id-1",
        userId: "owner-1",
        title: "Second",
        url: "https://b.example",
        position: 1,
      },
      {
        id: "id-2",
        userId: "owner-1",
        title: "Third",
        url: "https://c.example",
        position: 2,
      },
    ]);
  });

  it("builds no rows for a Profile whose owner removed every Link", () => {
    expect(linkRowsFor("owner-1", [], () => "unused")).toEqual([]);
  });

  /**
   * Ten dense positions are `0…9`, which is exactly what
   * `link_position_within_limit` admits. An eleventh would be `10` and the
   * `CHECK` refuses it — the structural limit `data-model.md` describes, rather
   * than a count this code takes.
   */
  it("keeps ten Links inside the CHECK's range, and puts an eleventh outside it", () => {
    const eleven = Array.from({ length: 11 }, (_entry, index) => ({
      title: `Link ${String(index)}`,
      url: "https://example.com",
    }));

    const rows = linkRowsFor("owner-1", eleven, () => "id");

    expect(rows.slice(0, 10).map((row) => row.position)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(rows[10]?.position).toBe(10);
  });
});

describe("createDrizzleProfileStore", () => {
  /**
   * A transaction that could not be opened must **fail loudly**. A store that
   * swallowed it would tell the owner their Profile was saved while the table
   * still holds yesterday's.
   */
  it("surfaces a connection failure rather than reporting a save", async () => {
    const handle = createDatabase({ url: URL });
    const store = createDrizzleProfileStore({ db: handle.db });

    const failure = await store
      .runInTransaction(() =>
        Promise.resolve({ commit: true, value: "unreachable" }),
      )
      .then((value) => `resolved: ${value}`)
      .catch((error: unknown) => messagesOf(error));

    expect(failure).toMatch(/ECONNREFUSED|connect/);
    await handle.close();
  });

  /**
   * A callback that reaches no verdict is a programming error, reported as
   * one — Drizzle resolves whatever the callback returns, so an implementation
   * that assumed a verdict would hand the caller `undefined` as a result.
   */
  it("refuses a unit of work that reaches no verdict", async () => {
    const handle = createDatabase({ url: URL });
    const store = createDrizzleProfileStore({ db: handle.db });

    const failure = await store
      .runInTransaction(() =>
        Promise.resolve({ commit: false, value: "never-reached" }),
      )
      .then((value) => `resolved: ${value}`)
      .catch((error: unknown) => messageOf(error));

    expect(failure).toMatch(/ECONNREFUSED|connect|without a verdict/);
    await handle.close();
  });
});

describe("profileTransactionOn against an unreachable database", () => {
  /**
   * **Fail closed.** A swallowed failure here reports a saved Profile to
   * somebody whose Links were never written — and because the write replaces
   * the whole list, the failure a caller must never miss is the one between the
   * delete and the insert.
   */
  it("does not report a save that never reached the table", async () => {
    const handle = createDatabase({ url: URL });
    const tx = profileTransactionOn(handle.db, () => "id-0");

    const failure = await tx
      .saveProfile({
        userId: "owner-1",
        displayName: "Ice Cube",
        bio: null,
        links: [{ title: "Home", url: "https://example.com" }],
        updatedAt: new Date("2026-09-13T09:30:00.000Z"),
      })
      .then(() => "resolved")
      .catch((error: unknown) => messagesOf(error));

    expect(failure).toMatch(/ECONNREFUSED|connect/);
    await handle.close();
  });
});
