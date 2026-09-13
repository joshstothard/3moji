/**
 * @jest-environment node
 */

/**
 * The boundary line itself (#156): one structured JSON line per call at an API
 * boundary, on success and on failure.
 *
 * Next.js's control flow is exercised with the **real** `redirect`,
 * `permanentRedirect` and `notFound` — `jest.setup.ts` stubs `next/navigation`
 * for every other suite, and a hand-built `{ digest }` object would prove
 * nothing once an upgrade changes what those functions throw.
 */
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

const headers = jest.fn((): Promise<Headers> =>
  Promise.resolve(new Headers({ "x-correlation-id": ID })),
);
jest.mock("next/headers", () => ({ headers: () => headers() }));

const navigation = jest.requireActual<{
  readonly redirect: (url: string) => never;
  readonly permanentRedirect: (url: string) => never;
  readonly notFound: () => never;
}>("next/navigation");

import {
  atBoundary,
  authEndpointOf,
  BOUNDARY_EVENT,
  outcomeOfStatus,
} from "./boundary-log";

/** Every line written to `console.log`, as written. */
const written: string[] = [];

beforeEach(() => {
  written.length = 0;
  headers.mockImplementation(() =>
    Promise.resolve(new Headers({ "x-correlation-id": ID })),
  );
  jest.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    written.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** The one line written, parsed; fails if there is not exactly one. */
function onlyLine(): Record<string, unknown> {
  expect(written).toHaveLength(1);
  const parsed: unknown = JSON.parse(written[0] ?? "");
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("the boundary line is not a JSON object");
  }
  return Object.fromEntries(Object.entries(parsed));
}

/** What `run` threw, or `undefined`. */
async function thrownBy(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("atBoundary", () => {
  it("writes one line with exactly the five fields, and returns the answer", async () => {
    const answer = await atBoundary("availability.check", () =>
      Promise.resolve("held"),
    );

    expect(answer).toBe("held");
    const line = onlyLine();
    expect(Object.keys(line).sort()).toEqual([
      "boundary",
      "correlationId",
      "durationMs",
      "event",
      "outcome",
    ]);
    expect(line).toMatchObject({
      event: BOUNDARY_EVENT,
      boundary: "availability.check",
      outcome: "ok",
      correlationId: ID,
    });
  });

  it("maps the returned answer to its outcome", async () => {
    await atBoundary(
      "claim.submit",
      () => Promise.resolve({ state: "rate-limited" }),
      {
        outcomeOf: (value) =>
          value.state === "rate-limited" ? "rate-limited" : "ok",
      },
    );

    expect(onlyLine().outcome).toBe("rate-limited");
  });

  it("prefers an outcome the boundary recorded over the mapping", async () => {
    await atBoundary(
      "verification.resend",
      (record) => {
        record("rejected");
        return Promise.resolve("anything");
      },
      { outcomeOf: () => "ok" },
    );

    expect(onlyLine().outcome).toBe("rejected");
  });

  it("measures the whole call, including time the boundary spent waiting", async () => {
    await atBoundary(
      "claim.submit",
      () =>
        new Promise((resolve) => {
          setTimeout(resolve, 40);
        }),
    );

    const { durationMs } = onlyLine();
    expect(typeof durationMs).toBe("number");
    expect(Number.isInteger(durationMs)).toBe(true);
    expect(durationMs).toBeGreaterThanOrEqual(35);
  });

  describe("Next.js control flow", () => {
    it("records a real redirect as redirected, and rethrows the very same error", async () => {
      let raised: unknown;
      const thrown = await thrownBy(
        atBoundary("sign-in.submit", () =>
          Promise.resolve().then(() => {
            try {
              navigation.redirect("/somewhere");
            } catch (error) {
              raised = error;
              throw error;
            }
          }),
        ),
      );

      expect(raised).toBeDefined();
      expect(thrown).toBe(raised);
      expect(onlyLine().outcome).toBe("redirected");
    });

    it("records a real permanent redirect as redirected", async () => {
      const thrown = await thrownBy(
        atBoundary("profile.save", () =>
          Promise.resolve().then(() => navigation.permanentRedirect("/x")),
        ),
      );

      expect(thrown).toBeDefined();
      expect(onlyLine().outcome).toBe("redirected");
    });

    it("keeps an outcome recorded before the redirect", async () => {
      await thrownBy(
        atBoundary("verification.resend", (record) => {
          record("rate-limited");
          return Promise.resolve().then(() => navigation.redirect("/held"));
        }),
      );

      expect(onlyLine().outcome).toBe("rate-limited");
    });

    it("records a real notFound as not-found, and rethrows it", async () => {
      const thrown = await thrownBy(
        atBoundary("claim.verify", () =>
          Promise.resolve().then(() => navigation.notFound()),
        ),
      );

      expect(thrown).toBeDefined();
      expect(onlyLine().outcome).toBe("not-found");
    });

    it("does not mistake an ordinary error whose message says NEXT_REDIRECT for a redirect", async () => {
      await thrownBy(
        atBoundary("claim.submit", () =>
          Promise.reject(new Error("NEXT_REDIRECT")),
        ),
      );

      expect(onlyLine().outcome).toBe("failed");
    });
  });

  describe("a failure", () => {
    it("is failed even when an outcome was recorded, and is rethrown untouched", async () => {
      const failure = new Error(
        "Key (email)=(someone@example.com) already exists.",
      );

      const thrown = await thrownBy(
        atBoundary("claim.verify", (record) => {
          record("redirected");
          return Promise.reject(failure);
        }),
      );

      expect(thrown).toBe(failure);
      expect(onlyLine().outcome).toBe("failed");
      expect(written.join("\n")).not.toContain("someone@example.com");
    });
  });

  describe("the correlation id", () => {
    it("is the sentinel when the request carries none", async () => {
      headers.mockImplementation(() => Promise.resolve(new Headers()));

      await atBoundary("auth.get", () => Promise.resolve(null));

      expect(onlyLine().correlationId).toBe("none");
    });

    it("is never a malformed value", async () => {
      headers.mockImplementation(() =>
        Promise.resolve(
          new Headers({ "x-correlation-id": `${ID}","outcome":"ok` }),
        ),
      );

      await atBoundary("auth.get", () => Promise.resolve(null));

      expect(onlyLine().correlationId).toBe("none");
    });
  });

  it("carries an auth endpoint when one is given", async () => {
    await atBoundary("auth.post", () => Promise.resolve(null), {
      endpoint: authEndpointOf("http://localhost:3000/api/auth/sign-in/email"),
    });

    expect(onlyLine()).toMatchObject({
      boundary: "auth.post",
      endpoint: "sign-in/email",
    });
  });

  it("never changes the answer when writing the line fails", async () => {
    jest.spyOn(console, "log").mockImplementation(() => {
      throw new Error("stdout closed");
    });

    await expect(
      atBoundary("availability.check", () => Promise.resolve("held")),
    ).resolves.toBe("held");
  });
});

describe("authEndpointOf", () => {
  it.each([
    ["/api/auth/sign-in/email", "sign-in/email"],
    ["/api/auth/get-session", "get-session"],
    ["/api/auth/request-password-reset", "request-password-reset"],
    ["/api/auth/reset-password", "reset-password"],
    ["/api/auth/verify-email?token=abc.def.ghi", "verify-email"],
    // The token is a path segment here, and is never repeated.
    [
      "/api/auth/reset-password/Secret-Reset-Token_123?callbackURL=%2F",
      "reset-password/:token",
    ],
    ["/api/auth/callback/google?code=xyz", "callback/:id"],
    ["/api/auth/someone@example.com", "other"],
    ["/api/auth/sign-in/email/extra", "other"],
    ["/api/auth/reset-password/a/b", "other"],
    ["/api/auth/", "other"],
    ["/elsewhere/sign-in/email", "other"],
  ])("reads %s as %s", (path, endpoint) => {
    expect(authEndpointOf(`http://localhost:3000${path}`)).toBe(endpoint);
  });

  it("answers other for something that is not a URL", () => {
    expect(authEndpointOf("not a url")).toBe("other");
  });
});

describe("outcomeOfStatus", () => {
  it.each([
    [200, "ok"],
    [204, "ok"],
    [302, "redirected"],
    [303, "redirected"],
    [400, "rejected"],
    [401, "rejected"],
    [403, "rejected"],
    [404, "not-found"],
    [429, "rate-limited"],
    [500, "failed"],
    [503, "failed"],
  ] as const)("reads %d as %s", (status, outcome) => {
    expect(outcomeOfStatus(status)).toBe(outcome);
  });
});
