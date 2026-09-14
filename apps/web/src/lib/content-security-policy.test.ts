/**
 * @jest-environment node
 */

/**
 * The Content Security Policy, built per request around a nonce (#205).
 *
 * The production policy is pinned in full, so a directive that is loosened,
 * dropped or added fails here. The development policy is asserted as the
 * production one plus exactly the two allowances `next dev` needs, so the
 * looser policy cannot drift into production through a shared string.
 */
import {
  buildContentSecurityPolicy,
  generateNonce,
  policyModeOf,
} from "./content-security-policy";

const NONCE = "ZmFrZS1ub25jZS0xMjM0NQ==";

/** The directives of a policy, by name, each with its source list. */
function directivesOf(policy: string): Map<string, readonly string[]> {
  const entries = policy
    .split(";")
    .map((directive) => directive.trim())
    .filter((directive) => directive.length > 0)
    .map((directive): [string, readonly string[]] => {
      const [name = "", ...sources] = directive.split(/\s+/);
      return [name, sources];
    });
  return new Map(entries);
}

describe("the production Content Security Policy", () => {
  const policy = buildContentSecurityPolicy(NONCE, "production");
  const directives = directivesOf(policy);

  it("is exactly the policy the owner chose (option 1)", () => {
    expect(policy).toBe(
      `default-src 'self'; script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'; style-src 'self' 'nonce-${NONCE}'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
    );
  });

  it("allows no eval and no inline script or style except by nonce", () => {
    expect(directives.get("script-src")).not.toContain("'unsafe-eval'");
    expect(directives.get("script-src")).not.toContain("'unsafe-inline'");
    expect(directives.get("style-src")).not.toContain("'unsafe-inline'");
    expect(directives.get("script-src")).toContain(`'nonce-${NONCE}'`);
    expect(directives.get("style-src")).toContain(`'nonce-${NONCE}'`);
  });

  it("refuses framing, plugins, a foreign base URL and a foreign form target", () => {
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("base-uri")).toEqual(["'self'"]);
    expect(directives.get("form-action")).toEqual(["'self'"]);
  });

  it("leaves out upgrade-insecure-requests, which breaks http://localhost", () => {
    expect(directives.has("upgrade-insecure-requests")).toBe(false);
  });
});

describe("the development Content Security Policy", () => {
  const production = directivesOf(
    buildContentSecurityPolicy(NONCE, "production"),
  );
  const development = directivesOf(
    buildContentSecurityPolicy(NONCE, "development"),
  );

  it("adds 'unsafe-eval' to script-src, which React needs in next dev", () => {
    expect(development.get("script-src")).toEqual([
      ...(production.get("script-src") ?? []),
      "'unsafe-eval'",
    ]);
  });

  it("allows inline styles, which next dev injects", () => {
    expect(development.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it("changes no other directive", () => {
    const others = (policy: Map<string, readonly string[]>) =>
      [...policy].filter(
        ([name]) => name !== "script-src" && name !== "style-src",
      );

    expect(others(development)).toEqual(others(production));
  });
});

describe("the nonce", () => {
  it("is 16 random bytes, base64-encoded", () => {
    const nonce = generateNonce();

    expect(nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(Buffer.from(nonce, "base64")).toHaveLength(16);
  });

  it("is different every time", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => generateNonce()));

    expect(nonces.size).toBe(50);
  });

  it.each([
    ["a quote that would end the source", "abc' 'unsafe-inline"],
    ["a semicolon that would start a directive", "abc; script-src *"],
    ["whitespace", "abc def"],
    ["nothing", ""],
  ])("is refused when it contains %s", (_what, nonce) => {
    expect(() => buildContentSecurityPolicy(nonce, "production")).toThrow();
  });
});

describe("the policy mode", () => {
  it("is development only under next dev", () => {
    expect(policyModeOf("development")).toBe("development");
  });

  it.each([["production"], ["test"], [undefined]])(
    "is production for NODE_ENV=%s",
    (nodeEnv) => {
      expect(policyModeOf(nodeEnv)).toBe("production");
    },
  );
});
