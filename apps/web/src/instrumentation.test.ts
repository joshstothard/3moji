/**
 * @jest-environment node
 */

/**
 * The instrumentation file is wiring and nothing else (#203).
 *
 * `lib/request-error.test.ts` proves what a render error writes. This proves
 * `onRequestError` is that handler, and that the file exports nothing else:
 * `scripts/tracing-guard.test.mjs` fails the build on a `register()` or a
 * tracing import, and this keeps the module's own surface honest too.
 */
import "./test-support/next-async-local-storage";

import * as instrumentation from "./instrumentation";
import { REQUEST_FAILED_EVENT } from "./lib/request-error";
import { thrownError } from "./test-support/thrown-error";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("instrumentation", () => {
  it("exports onRequestError and nothing else", () => {
    expect(Object.keys(instrumentation)).toEqual(["onRequestError"]);
  });

  it("reports a render error as one request_failed line with the request's id", async () => {
    const spy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await instrumentation.onRequestError(
        thrownError(),
        { path: "/", method: "GET", headers: { "x-correlation-id": ID } },
        {
          routerKind: "App Router",
          routePath: "/test-only-error",
          routeType: "render",
          renderSource: "react-server-components",
          revalidateReason: undefined,
        },
      );
      const lines = spy.mock.calls.map(([line]): unknown =>
        JSON.parse(String(line)),
      );

      expect(lines).toEqual([
        {
          event: REQUEST_FAILED_EVENT,
          correlationId: ID,
          error: { name: "Error" },
        },
      ]);
    } finally {
      spy.mockRestore();
    }
  });
});
