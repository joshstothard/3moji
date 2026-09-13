/**
 * @jest-environment node
 */
import { isDeployed } from "./deployment";

/**
 * Whether a process is a deployment real people use. The two test-only
 * switches, `TEST_EMAIL_SENDER` (#151) and `TEST_ERROR_ROUTE` (#203), are both
 * refused when this answers true.
 */
describe("isDeployed", () => {
  it("is true under NODE_ENV=production", () => {
    expect(isDeployed({ NODE_ENV: "production" })).toBe(true);
  });

  it.each(["production", "preview", "development"])(
    "is true on any Vercel deployment (VERCEL_ENV=%s)",
    (vercelEnv) => {
      expect(
        isDeployed({ NODE_ENV: "development", VERCEL_ENV: vercelEnv }),
      ).toBe(true);
    },
  );

  it("is false for a development or test process", () => {
    expect(isDeployed({ NODE_ENV: "development" })).toBe(false);
    expect(isDeployed({ NODE_ENV: "test", VERCEL_ENV: "" })).toBe(false);
    expect(isDeployed({})).toBe(false);
  });
});
