import {
  AUTH_RATE_LIMITS,
  AUTH_RATE_LIMIT_MODEL,
  CLIENT_ADDRESS_HEADERS,
  authClientAddressOptions,
  authRateLimitOptions,
} from "./auth-rate-limit";

const MINUTE = 60;
const HOUR = 60 * MINUTE;

/**
 * Better Auth 1.7.4's own built-in rules, read from
 * `better-auth/dist/api/rate-limiter/index.mjs` (`getDefaultSpecialRules`).
 * They apply the moment rate limiting is enabled, with no `customRules` at all.
 */
const BETTER_AUTH_BUILT_IN_MAX = 3;

describe("AUTH_RATE_LIMITS", () => {
  it("starts at the values flagged for the repo owner on #158", () => {
    // Spelled out rather than derived: tuning a limit is meant to be a
    // deliberate edit, and this is the test that makes it one. Windows are in
    // seconds, because that is the unit Better Auth reads.
    expect(AUTH_RATE_LIMITS).toEqual({
      default: { window: 10, max: 100 },
      signInEmail: { window: 15 * MINUTE, max: 10 },
      requestPasswordReset: { window: HOUR, max: 5 },
      sendVerificationEmail: { window: HOUR, max: 5 },
    });
  });

  it("never uses Better Auth's built-in maximum, so a boundary test proves our rule binds", () => {
    // With a maximum of 3, "the fourth request is refused" would pass with
    // every custom rule deleted, because the built-in rule would refuse it.
    const maxima = [
      AUTH_RATE_LIMITS.signInEmail.max,
      AUTH_RATE_LIMITS.requestPasswordReset.max,
      AUTH_RATE_LIMITS.sendVerificationEmail.max,
    ];
    expect(maxima).not.toContain(BETTER_AUTH_BUILT_IN_MAX);
  });
});

describe("authRateLimitOptions", () => {
  it("is on in every environment, counts in the database, and names each limited path", () => {
    expect(authRateLimitOptions()).toEqual({
      enabled: true,
      storage: "database",
      modelName: AUTH_RATE_LIMIT_MODEL,
      window: 10,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 15 * MINUTE, max: 10 },
        "/request-password-reset": { window: HOUR, max: 5 },
        "/send-verification-email": { window: HOUR, max: 5 },
      },
    });
  });

  it("names the table in snake case beside claim_rate_limit", () => {
    expect(AUTH_RATE_LIMIT_MODEL).toBe("auth_rate_limit");
  });
});

describe("authClientAddressOptions", () => {
  it("reads the client address from the headers the Claim's limiter reads, in the same order", () => {
    expect(CLIENT_ADDRESS_HEADERS).toEqual([
      "x-vercel-forwarded-for",
      "x-forwarded-for",
    ]);
    expect(authClientAddressOptions()).toEqual({
      ipAddressHeaders: ["x-vercel-forwarded-for", "x-forwarded-for"],
      ipv6Subnet: 64,
    });
  });
});
