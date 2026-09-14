/**
 * @jest-environment node
 */

/**
 * The share link: the site origin, `/`, and the canonical word alias
 * ([#160](https://github.com/joshstothard/3moji/issues/160), ADR-0008
 * decision 3).
 *
 * `@template/core` is mocked for the reason every web suite mocks it — its
 * root entry reaches better-auth, which cannot be `require`d here — and
 * because the alias itself is `canonicalAliasOf`'s, asserted against the
 * real curated names in `packages/core/src/handle/alias.test.ts`. What belongs
 * here is the composition and where the origin comes from.
 */
const canonicalAliasOf = jest.fn(
  (_codepoints: readonly string[]): string | undefined =>
    "ice-cube.ice-cube.ice-cube",
);
jest.mock("@template/core", () => ({
  canonicalAliasOf: (codepoints: readonly string[]) =>
    canonicalAliasOf(codepoints),
}));

import { shareLinkOf, siteOrigin } from "./share-link";

const ICE = "\u{1F9CA}";
const saved = process.env.BETTER_AUTH_URL;

function setOrigin(value: string | undefined): void {
  if (value === undefined)
    Reflect.deleteProperty(process.env, "BETTER_AUTH_URL");
  else process.env.BETTER_AUTH_URL = value;
}

afterAll(() => {
  setOrigin(saved);
});

beforeEach(() => {
  jest.clearAllMocks();
  canonicalAliasOf.mockReturnValue("ice-cube.ice-cube.ice-cube");
});

describe("the site origin", () => {
  it("is taken from BETTER_AUTH_URL, the configured address the app is served from", () => {
    setOrigin("https://3moji.me");

    expect(siteOrigin()).toBe("https://3moji.me");
  });

  it.each([
    ["a trailing slash", "http://localhost:3000/", "http://localhost:3000"],
    ["a path", "https://3moji.me/api/auth", "https://3moji.me"],
    ["an upper-case host", "https://3MOJI.me", "https://3moji.me"],
  ])(
    "is reduced to the bare origin when the value has %s",
    (_name, value, origin) => {
      setOrigin(value);

      expect(siteOrigin()).toBe(origin);
    },
  );

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["not a URL", "3moji.me"],
    ["not http or https", "javascript:alert(1)"],
  ])(
    "is undefined when the variable is %s, never a guessed host",
    (_name, value) => {
      setOrigin(value);

      expect(siteOrigin()).toBeUndefined();
    },
  );
});

describe("the share link", () => {
  it("is exactly the origin, a slash and the canonical alias", () => {
    setOrigin("http://localhost:3000/");

    expect(shareLinkOf([ICE, ICE, ICE])).toEqual({
      href: "http://localhost:3000/ice-cube.ice-cube.ice-cube",
      alias: "ice-cube.ice-cube.ice-cube",
    });
    expect(canonicalAliasOf).toHaveBeenCalledWith([ICE, ICE, ICE]);
  });

  it("is never the percent-encoded emoji URL", () => {
    setOrigin("https://3moji.me");

    const link = shareLinkOf([ICE, ICE, ICE]);

    expect(link?.href).not.toMatch(/%/);
    expect(link?.href).not.toContain(ICE);
  });

  it("is omitted when the Handle has no canonical alias", () => {
    setOrigin("https://3moji.me");
    canonicalAliasOf.mockReturnValue(undefined);

    expect(shareLinkOf([ICE, ICE, ICE])).toBeUndefined();
  });

  it("is omitted when there is no configured origin", () => {
    setOrigin(undefined);

    expect(shareLinkOf([ICE, ICE, ICE])).toBeUndefined();
  });
});

describe("on a Vercel preview (#32)", () => {
  const VERCEL = ["VERCEL_ENV", "VERCEL_BRANCH_URL", "VERCEL_URL"] as const;
  const savedVercel = new Map<string, string | undefined>(
    VERCEL.map((name) => [name, process.env[name]]),
  );

  afterEach(() => {
    for (const name of VERCEL) {
      const value = savedVercel.get(name);
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = value;
    }
  });

  it("shares the preview's own address, so a share link and a verification link agree", () => {
    setOrigin("https://3moji.example.com");
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_BRANCH_URL = "3moji-git-feature.vercel.example.com";

    expect(shareLinkOf([ICE, ICE, ICE])?.href).toBe(
      "https://3moji-git-feature.vercel.example.com/ice-cube.ice-cube.ice-cube",
    );
  });
});
