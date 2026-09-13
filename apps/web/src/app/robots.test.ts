/**
 * @jest-environment node
 */

// `@template/core`'s root entry reaches better-auth, which cannot be
// `require`d here; `lib/share-link.ts` imports it, and robots uses none of it.
jest.mock("@template/core", () => ({ canonicalAliasOf: () => undefined }));

import robots from "./robots";

const ORIGIN = "https://3moji.example";

const savedOrigin = process.env.BETTER_AUTH_URL;
afterEach(() => {
  if (savedOrigin === undefined) {
    Reflect.deleteProperty(process.env, "BETTER_AUTH_URL");
  } else {
    process.env.BETTER_AUTH_URL = savedOrigin;
  }
});

describe("/robots.txt (#204)", () => {
  it("lets every crawler in and points at the sitemap on the configured origin", () => {
    process.env.BETTER_AUTH_URL = `${ORIGIN}/`;

    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/" },
      sitemap: `${ORIGIN}/sitemap.xml`,
    });
  });

  it("names no sitemap when no origin is configured, rather than guessing a host", () => {
    Reflect.deleteProperty(process.env, "BETTER_AUTH_URL");

    const served = robots();

    expect(served.rules).toEqual({ userAgent: "*", allow: "/" });
    expect(served).not.toHaveProperty("sitemap");
  });
});
