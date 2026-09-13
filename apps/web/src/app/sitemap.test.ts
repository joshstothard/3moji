/**
 * @jest-environment node
 */

// `@template/core`'s root entry reaches better-auth, which cannot be
// `require`d here; `lib/share-link.ts` imports it, and the sitemap uses none of it.
jest.mock("@template/core", () => ({ canonicalAliasOf: () => undefined }));

import sitemap from "./sitemap";

const ORIGIN = "https://3moji.example";

const savedOrigin = process.env.BETTER_AUTH_URL;
afterEach(() => {
  if (savedOrigin === undefined) {
    Reflect.deleteProperty(process.env, "BETTER_AUTH_URL");
  } else {
    process.env.BETTER_AUTH_URL = savedOrigin;
  }
});

describe("/sitemap.xml (#204)", () => {
  it("lists exactly the home page, the privacy notice and the terms, as absolute URLs", () => {
    process.env.BETTER_AUTH_URL = `${ORIGIN}/api/auth`;

    expect(sitemap().map((entry) => entry.url)).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/privacy`,
      `${ORIGIN}/terms`,
    ]);
  });

  it("lists no Handle, word alias or noindex page, so it never publishes who has claimed what", () => {
    process.env.BETTER_AUTH_URL = ORIGIN;
    const entries = sitemap();

    expect(entries.length).toBeGreaterThan(0);
    for (const { url } of entries) {
      const path = new URL(url).pathname;
      expect(path).not.toMatch(/%F0%9F|\p{Extended_Pictographic}|\./u);
      expect(path).not.toMatch(/^\/(find|reset-password|claim|sign-in)/);
    }
  });

  it("is empty when no origin is configured, rather than guessing a host", () => {
    Reflect.deleteProperty(process.env, "BETTER_AUTH_URL");

    expect(sitemap()).toEqual([]);
  });
});
