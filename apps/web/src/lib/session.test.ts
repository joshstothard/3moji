/**
 * @jest-environment node
 */

/**
 * The one place an identity enters the application.
 *
 * Everything worth asserting here is about **failing closed**: this is the
 * value every authorisation decision downstream is made about, so a session
 * read that answered "somebody" when it could not tell would be an
 * authorisation bypass rather than a rendering glitch.
 */
const getSession = jest.fn(
  (_input: { headers: Headers }): Promise<{ user: { id: string } } | null> =>
    Promise.resolve({ user: { id: "owner" } }),
);

let services: () => { auth: unknown } = () => ({
  auth: { api: { getSession } },
});
jest.mock("./services", () => ({ getServices: () => services() }));

const headers = jest.fn(() => Promise.resolve(new Headers({ cookie: "a=b" })));
jest.mock("next/headers", () => ({ headers: () => headers() }));

import { readViewer } from "./session";

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  services = () => ({ auth: { api: { getSession } } });
  getSession.mockResolvedValue({ user: { id: "owner" } });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("readViewer", () => {
  it("answers the id on the session, and nothing else from it", async () => {
    expect(await readViewer()).toEqual({ userId: "owner" });
  });

  /** The request's own headers, so the cookie is the one being presented. */
  it("asks about the incoming request's headers", async () => {
    await readViewer();

    expect(getSession).toHaveBeenCalledWith({
      headers: expect.any(Headers) as Headers,
    });
  });

  it("answers nobody when there is no session", async () => {
    getSession.mockResolvedValue(null);

    expect(await readViewer()).toBeUndefined();
  });

  it("answers nobody when the session lookup is refused", async () => {
    getSession.mockRejectedValue(new Error("connect ECONNREFUSED"));

    expect(await readViewer()).toBeUndefined();
  });

  it.each([
    [
      "an email address",
      `Key (email)=(someone@example.com) already exists.`,
      "someone@example.com",
    ],
    [
      "a password",
      `password authentication failed: "hunter2-Tr0ub4dor&3"`,
      "hunter2-Tr0ub4dor&3",
    ],
  ])(
    "keeps %s in the error's message out of the log line (#134)",
    async (_what, message, secret) => {
      const logged = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      getSession.mockRejectedValue(new Error(message));
      await readViewer();
      const output = JSON.stringify(logged.mock.calls);
      expect(output).toContain("session_read_failed");
      expect(output).not.toContain(secret);
      logged.mockRestore();
    },
  );

  it("answers nobody when the services cannot be built at all", async () => {
    services = () => {
      throw new Error("BETTER_AUTH_SECRET is not set");
    };

    expect(await readViewer()).toBeUndefined();
  });
});
