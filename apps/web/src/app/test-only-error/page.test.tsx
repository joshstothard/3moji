/**
 * @jest-environment node
 */

/**
 * The page CI's E2E job throws from (#203), so the branded error page is
 * rendered by the real app and checked by axe in both Playwright projects.
 *
 * **It is a 404 unless a test run switched it on**, and it is a 404 on every
 * deployment whatever the switch says (`lib/test-error-route.ts`), so no
 * production process has a route that fails on request.
 */
const notFound = jest.fn((): never => {
  throw new Error("NEXT_NOT_FOUND");
});
jest.mock("next/navigation", () => ({ notFound: () => notFound() }));

import TestOnlyErrorPage, { dynamic, metadata } from "./page";
import { TEST_ERROR_MESSAGE } from "../../lib/test-error-route";

const saved = process.env.TEST_ERROR_ROUTE;

function setSwitch(value: string | undefined): void {
  if (value === undefined)
    Reflect.deleteProperty(process.env, "TEST_ERROR_ROUTE");
  else process.env.TEST_ERROR_ROUTE = value;
}

afterEach(() => {
  setSwitch(saved);
  notFound.mockClear();
});

describe("the test-only error page", () => {
  it("is a 404 when the switch is off", () => {
    setSwitch(undefined);

    expect(() => TestOnlyErrorPage()).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("throws when a test run switched it on", () => {
    setSwitch("enabled");

    expect(() => TestOnlyErrorPage()).toThrow(TEST_ERROR_MESSAGE);
    expect(notFound).not.toHaveBeenCalled();
  });

  it("reads the switch per request, never once at build time", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("asks not to be indexed", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
