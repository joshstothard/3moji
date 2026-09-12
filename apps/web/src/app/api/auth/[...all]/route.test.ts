/**
 * @jest-environment node
 */
const handlerGet = jest.fn();
const handlerPost = jest.fn();
const toNextJsHandler = jest.fn((_auth: unknown) => ({
  GET: handlerGet,
  POST: handlerPost,
}));
const getServices = jest.fn(() => ({ auth: { marker: "auth-instance" } }));

jest.mock("better-auth/next-js", () => ({
  toNextJsHandler: (auth: unknown) => toNextJsHandler(auth),
}));
jest.mock("../../../../lib/services", () => ({
  getServices: () => getServices(),
}));

import { GET, POST } from "./route";

describe("the auth route handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    handlerGet.mockResolvedValue(new Response("ok-get"));
    handlerPost.mockResolvedValue(new Response("ok-post"));
  });

  it("delegates GET to Better Auth and returns its response", async () => {
    const request = new Request("http://localhost:3000/api/auth/session");

    const response = await GET(request);

    expect(handlerGet).toHaveBeenCalledWith(request);
    expect(await response.text()).toBe("ok-get");
  });

  it("delegates POST to Better Auth and returns its response", async () => {
    const request = new Request(
      "http://localhost:3000/api/auth/sign-up/email",
      {
        method: "POST",
      },
    );

    const response = await POST(request);

    expect(handlerPost).toHaveBeenCalledWith(request);
    expect(await response.text()).toBe("ok-post");
  });

  it("resolves services per request rather than at module scope", async () => {
    // Import happened above with no calls; construction is deferred so that
    // `next build` does not need a populated environment.
    expect(getServices).not.toHaveBeenCalled();

    await GET(new Request("http://localhost:3000/api/auth/session"));

    expect(getServices).toHaveBeenCalledTimes(1);
  });
});
