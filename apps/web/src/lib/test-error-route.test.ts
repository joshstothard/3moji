/**
 * @jest-environment node
 */
import { isTestErrorRouteEnabled } from "./test-error-route";

/**
 * The switch for `/test-only-error`, the page CI's E2E job throws from so the
 * branded error page can be checked by axe in a real browser (#203).
 *
 * **Off unless asked for, and off on every deployment whatever it says.** The
 * page answers 404 when this is false, so a production process has no route
 * that crashes on request.
 */
describe("isTestErrorRouteEnabled", () => {
  it("is on when a test run asks for it and the process is not deployed", () => {
    expect(
      isTestErrorRouteEnabled({
        TEST_ERROR_ROUTE: "enabled",
        NODE_ENV: "development",
      }),
    ).toBe(true);
  });

  it("is off by default", () => {
    expect(isTestErrorRouteEnabled({ NODE_ENV: "development" })).toBe(false);
  });

  it.each(["", "true", "1", "on", "ENABLED"])(
    "is off for %p: only the one spelled-out value counts",
    (value) => {
      expect(
        isTestErrorRouteEnabled({
          TEST_ERROR_ROUTE: value,
          NODE_ENV: "development",
        }),
      ).toBe(false);
    },
  );

  it("is off in production, whatever the switch says", () => {
    expect(
      isTestErrorRouteEnabled({
        TEST_ERROR_ROUTE: "enabled",
        NODE_ENV: "production",
      }),
    ).toBe(false);
  });

  it("is off on a Vercel preview, whatever the switch says", () => {
    expect(
      isTestErrorRouteEnabled({
        TEST_ERROR_ROUTE: "enabled",
        NODE_ENV: "development",
        VERCEL_ENV: "preview",
      }),
    ).toBe(false);
  });
});
