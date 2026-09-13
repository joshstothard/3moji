/**
 * @jest-environment node
 */

/**
 * What the signed-in indicator is told, composed from the session (#193).
 *
 * The rule is `viewerSummary` in `packages/core` and is faked here, because
 * `@template/core` cannot be `require`d under this suite; what belongs here is
 * that the two server-side facts reach it — the session, and what that
 * session's Account owns — and that a failed read fails closed.
 */
const ICE = "\u{1F9CA}\u{1F9CA}\u{1F9CA}";
const OWNED = {
  key: ICE,
  heldUntil: new Date("2026-09-02T00:00:00.000Z"),
  claimedAt: new Date("2026-09-01T00:00:00.000Z"),
};

const viewerSummary = jest.fn((input: unknown): unknown => ({
  state: "from-rule",
  input,
}));
jest.mock("@template/core", () => ({
  viewerSummary: (input: unknown): unknown => viewerSummary(input),
}));

const readViewer = jest.fn((): Promise<{ userId: string } | undefined> =>
  Promise.resolve({ userId: "owner-1" }),
);
jest.mock("./session", () => ({ readViewer: () => readViewer() }));

const handleOf = jest.fn((_userId: string): Promise<unknown> =>
  Promise.resolve(OWNED),
);
let services: () => unknown = () => ({ accounts: { handleOf } });
jest.mock("./services", () => ({ getServices: () => services() }));

import { readViewerSummary } from "./viewer";

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  services = () => ({ accounts: { handleOf } });
  readViewer.mockResolvedValue({ userId: "owner-1" });
  handleOf.mockResolvedValue(OWNED);
  viewerSummary.mockClear();
  handleOf.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Every structured line written to `console.error`, parsed. */
function errorLines(): Record<string, unknown>[] {
  return jest
    .mocked(console.error)
    .mock.calls.map(
      (call) => JSON.parse(String(call[0])) as Record<string, unknown>,
    );
}

describe("readViewerSummary", () => {
  it("hands the rule the session's viewer and what that Account owns", async () => {
    const answer = await readViewerSummary();

    expect(handleOf).toHaveBeenCalledWith("owner-1");
    expect(viewerSummary).toHaveBeenCalledWith({
      viewer: { userId: "owner-1" },
      owned: OWNED,
    });
    expect(answer).toEqual({
      state: "from-rule",
      input: { viewer: { userId: "owner-1" }, owned: OWNED },
    });
  });

  it("reads no Account for a visitor with no session", async () => {
    readViewer.mockResolvedValue(undefined);

    await readViewerSummary();

    expect(handleOf).not.toHaveBeenCalled();
    expect(viewerSummary).toHaveBeenCalledWith({
      viewer: undefined,
      owned: undefined,
    });
  });

  it("answers the rule's signed-in case, with no Handle, when the Account read is refused", async () => {
    handleOf.mockRejectedValue(new Error("connect ECONNREFUSED"));

    await readViewerSummary();

    expect(viewerSummary).toHaveBeenCalledWith({
      viewer: { userId: "owner-1" },
      owned: undefined,
    });
    expect(errorLines()).toEqual([
      expect.objectContaining({ event: "viewer_summary_read_failed" }),
    ]);
  });

  it("answers the rule's signed-in case when the services cannot be built for a named viewer", async () => {
    services = () => {
      throw new Error("DATABASE_URL is not set.");
    };

    await expect(readViewerSummary()).resolves.toEqual({
      state: "from-rule",
      input: { viewer: { userId: "owner-1" }, owned: undefined },
    });
  });

  it("logs no free text from a failed read", async () => {
    handleOf.mockRejectedValue(
      new Error("Key (email)=(someone@example.com) already exists"),
    );

    await readViewerSummary();

    expect(JSON.stringify(errorLines())).not.toContain("someone@example.com");
  });
});
