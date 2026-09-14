/**
 * @jest-environment node
 */

/**
 * Where the app is served from (#32).
 *
 * `BETTER_AUTH_URL` is set to the production address for Preview deployments
 * too, so without this every verification and reset link a preview emails
 * would point at production — whose database is not the preview's branch, so
 * the link would find no token. On a preview the address is the deployment's
 * own, from the system variables Vercel sets.
 */
import { configuredSiteUrl } from "./site-url";

const PRODUCTION = "https://3moji.example.com";
const BRANCH = "3moji-git-feature-owner.vercel.example.com";
const DEPLOYMENT = "3moji-abc123-owner.vercel.example.com";

describe("configuredSiteUrl", () => {
  it("is BETTER_AUTH_URL outside Vercel", () => {
    expect(configuredSiteUrl({ BETTER_AUTH_URL: PRODUCTION })).toBe(PRODUCTION);
  });

  it("is BETTER_AUTH_URL on a production deployment, whatever Vercel's own URLs are", () => {
    expect(
      configuredSiteUrl({
        VERCEL_ENV: "production",
        BETTER_AUTH_URL: PRODUCTION,
        VERCEL_BRANCH_URL: BRANCH,
        VERCEL_URL: DEPLOYMENT,
      }),
    ).toBe(PRODUCTION);
  });

  it("is the branch URL on a preview, so a link survives a redeploy of the same branch", () => {
    expect(
      configuredSiteUrl({
        VERCEL_ENV: "preview",
        BETTER_AUTH_URL: PRODUCTION,
        VERCEL_BRANCH_URL: BRANCH,
        VERCEL_URL: DEPLOYMENT,
      }),
    ).toBe(`https://${BRANCH}`);
  });

  it("falls back to the deployment URL on a preview with no branch URL", () => {
    expect(
      configuredSiteUrl({
        VERCEL_ENV: "preview",
        BETTER_AUTH_URL: PRODUCTION,
        VERCEL_BRANCH_URL: "",
        VERCEL_URL: DEPLOYMENT,
      }),
    ).toBe(`https://${DEPLOYMENT}`);
  });

  it("is undefined on a preview with neither, never the production address", () => {
    expect(
      configuredSiteUrl({ VERCEL_ENV: "preview", BETTER_AUTH_URL: PRODUCTION }),
    ).toBeUndefined();
  });

  it.each([
    ["a path", "evil.example.com/x"],
    ["a scheme", "https://evil.example.com"],
    ["a user", "user@evil.example.com"],
    ["whitespace", "evil.example.com x"],
  ])("refuses a preview host carrying %s", (_name, host) => {
    expect(
      configuredSiteUrl({
        VERCEL_ENV: "preview",
        BETTER_AUTH_URL: PRODUCTION,
        VERCEL_BRANCH_URL: host,
      }),
    ).toBeUndefined();
  });

  it("is undefined when nothing is configured", () => {
    expect(configuredSiteUrl({})).toBeUndefined();
    expect(configuredSiteUrl({ BETTER_AUTH_URL: "" })).toBeUndefined();
  });
});
