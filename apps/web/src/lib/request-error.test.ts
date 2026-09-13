/**
 * @jest-environment node
 */

/**
 * What should happen to an error nothing caught (#203).
 *
 * `reportRequestError` is the body Next.js's server-side `onRequestError` hook
 * would have. The hook is not wired: its `instrumentation` file is blocked by
 * `scripts/tracing-guard.test.mjs` pending the tracing decision in `AGENTS.md`
 * § Observability (#148). So this proves the behaviour, not a live path: one
 * `logFailure` line, carrying the request's correlation id and never the
 * message, and nothing for `notFound()` or a redirect.
 */
import "../test-support/next-async-local-storage";

import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";

import { NO_CORRELATION_ID } from "./correlation-id";
import { REQUEST_FAILED_EVENT, reportRequestError } from "./request-error";
import { thrownError } from "../test-support/thrown-error";

/** `jest.setup.ts` stubs `next/navigation`; these are the real throws. */
const navigation = jest.requireActual<{
  notFound: () => never;
  redirect: (url: string) => never;
  permanentRedirect: (url: string) => never;
}>("next/navigation");

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const STORE_ID = "iad1::abcde-1700000000000-0123456789ab";

function requestWith(
  headers: Record<string, string | string[] | undefined>,
): Readonly<{
  path: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
}> {
  return { path: "/", method: "GET", headers };
}

/** Every line written to `console.error` while `run` ran, parsed. */
function linesWrittenBy(run: () => void): unknown[] {
  const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    run();
    return spy.mock.calls.map(([line]): unknown => JSON.parse(String(line)));
  } finally {
    spy.mockRestore();
  }
}

/** Run `run` inside Next.js's real request store, holding `id`. */
function insideRequest(id: string, run: () => void): void {
  const store = {
    type: "request",
    headers: new Headers({ "x-correlation-id": id }),
  };
  Reflect.apply(
    workUnitAsyncStorage.run.bind(workUnitAsyncStorage),
    undefined,
    [store, run],
  );
}

function thrownBy(signal: () => never): unknown {
  try {
    signal();
  } catch (error) {
    return error;
  }
  throw new Error("The signal did not throw.");
}

describe("reportRequestError", () => {
  it("logs one line, with the correlation id the proxy put on the request", () => {
    const lines = linesWrittenBy(() => {
      reportRequestError(
        thrownError(),
        requestWith({ "x-correlation-id": ID }),
      );
    });

    expect(REQUEST_FAILED_EVENT).toBe("request_failed");
    expect(lines).toEqual([
      {
        event: REQUEST_FAILED_EVENT,
        correlationId: ID,
        error: { name: "Error" },
      },
    ]);
  });

  it("never writes the message, the digest or the stack", () => {
    const spy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      reportRequestError(
        thrownError(),
        requestWith({ "x-correlation-id": ID }),
      );
      const written = JSON.stringify(spy.mock.calls);

      expect(written).not.toContain("someone@example.com");
      expect(written).not.toContain("2718281828");
      expect(written).not.toContain("page.tsx");
    } finally {
      spy.mockRestore();
    }
  });

  it("reads the request store when the header is absent", () => {
    let lines: unknown[] = [];
    insideRequest(STORE_ID, () => {
      lines = linesWrittenBy(() => {
        reportRequestError(thrownError(), requestWith({}));
      });
    });

    expect(lines).toEqual([
      expect.objectContaining({ correlationId: STORE_ID }),
    ]);
  });

  it.each([
    ["a value that fails the allow-list", `${ID}"},{"event":"forged`],
    ["a repeated header", [ID, ID]],
    ["an empty value", ""],
  ])("does not take the id from %s", (_case, value) => {
    const lines = linesWrittenBy(() => {
      reportRequestError(
        thrownError(),
        requestWith({ "x-correlation-id": value }),
      );
    });

    expect(lines).toEqual([
      expect.objectContaining({ correlationId: NO_CORRELATION_ID }),
    ]);
  });

  it.each([
    ["notFound()", () => navigation.notFound()],
    ["redirect()", () => navigation.redirect("/somewhere")],
    ["permanentRedirect()", () => navigation.permanentRedirect("/somewhere")],
  ])(
    "logs nothing for %s, which is an answer, not a failure",
    (_name, signal) => {
      const lines = linesWrittenBy(() => {
        reportRequestError(
          thrownBy(signal),
          requestWith({ "x-correlation-id": ID }),
        );
      });

      expect(lines).toEqual([]);
    },
  );
});
