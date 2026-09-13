/**
 * @jest-environment node
 */

/**
 * The proxy gives every request a correlation id (#155).
 *
 * What is asserted is what leaves the proxy: the `x-correlation-id` on the
 * response, and the same value on the request the application sees. The
 * request side is read back through Next.js's own encoding of an overridden
 * request header (`x-middleware-request-*`), pinned here against 16.3.5; the
 * end-to-end proof that a route really reads it is `request-context.ts`'s
 * contract test and a request against the running app.
 */
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

import { config, proxy } from "./proxy";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERCEL_ID = "lhr1::iad1::8x2kq-1757770000000-3f9a1c2b7d4e";
const NEWLINE = String.fromCharCode(10);

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(
    "https://3moji.me/%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A",
    {
      headers,
    },
  );
}

/** The id on the response, and the id on the request the app will see. */
function idsOf(response: Response): {
  readonly response: string | null;
  readonly request: string | null;
} {
  return {
    response: response.headers.get("x-correlation-id"),
    request: response.headers.get("x-middleware-request-x-correlation-id"),
  };
}

describe("proxy", () => {
  it("uses a well-formed x-vercel-id on the request and the response", () => {
    const ids = idsOf(proxy(request({ "x-vercel-id": VERCEL_ID })));

    expect(ids).toEqual({ response: VERCEL_ID, request: VERCEL_ID });
  });

  it("generates a random UUID when there is no x-vercel-id", () => {
    const ids = idsOf(proxy(request()));

    expect(ids.response).toMatch(UUID_V4);
    expect(ids.request).toBe(ids.response);
  });

  it("does not change where the request goes", () => {
    const response = proxy(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
  });

  it("never trusts a client-sent x-correlation-id", () => {
    const ids = idsOf(
      proxy(
        request({ "x-correlation-id": "0f8fad5b-d9cb-469f-a165-70867728950e" }),
      ),
    );

    expect(ids.response).not.toBe("0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(ids.response).toMatch(UUID_V4);
    expect(ids.request).toBe(ids.response);
  });

  // `Headers` itself refuses a raw newline, so a client cannot deliver one in
  // a header at all; the encoded forms below are what can actually arrive.
  it.each([
    ["a JSON-breaking value", `"},{"event":"forged`],
    ["JSON braces", `{"correlationId":"x"}`],
    ["an escaped newline", `abc\\n{"event":"forged"}`],
    ["an overlong value", "a".repeat(500)],
    ["a percent-encoded newline", "lhr1::%0A%0D"],
  ])("replaces %s in x-vercel-id and never echoes it", (_what, value) => {
    const response = proxy(request({ "x-vercel-id": value }));
    const ids = idsOf(response);

    expect(ids.response).toMatch(UUID_V4);
    expect(ids.request).toBe(ids.response);
    // Every header a client receives. Next.js's `x-middleware-request-*`
    // headers are its internal encoding of the forwarded request — they carry
    // the client's own `x-vercel-id` under that name, and are stripped before
    // the response leaves the server — so they are not an echo; the id on the
    // request is asserted above instead.
    for (const [name, header] of response.headers) {
      if (name.startsWith("x-middleware-")) continue;
      expect(header).not.toContain(value);
    }
  });

  it("refuses a newline before it can reach the proxy at all", () => {
    expect(() =>
      request({ "x-vercel-id": `${VERCEL_ID}${NEWLINE}forged` }),
    ).toThrow();
  });
});

describe("the proxy's matcher", () => {
  it.each([
    "/",
    "/%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A",
    "/%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A/edit",
    // A dotted word alias (ADR-0008) is a page, not a static file.
    "/ice-cube.ice-cube.ice-cube",
    "/api/auth/ok",
    "/sign-in",
  ])("runs on %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  });

  it.each([
    "/_next/static/chunks/main.js",
    "/_next/static/css/app.css",
    "/_next/image?url=%2Fa.png&w=64&q=75",
    "/favicon.ico",
    "/robots.txt",
    "/sitemap.xml",
  ])("skips %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
  });
});
