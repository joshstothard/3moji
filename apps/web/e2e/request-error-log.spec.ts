import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { TEST_ERROR_MESSAGE } from "../src/lib/test-error-route";

/**
 * An error nothing caught while rendering a page is logged once, on the
 * server, with the request's correlation id
 * ([#203](https://github.com/joshstothard/3moji/issues/203)).
 *
 * `request-error.test.ts` proves the body of the hook. This proves the live
 * path: that Next.js calls `onRequestError` from `src/instrumentation.ts` once
 * per failed request, inside the request whose id the response returned, and
 * never for an answer that works by throwing or redirecting.
 *
 * **The seam is the server's own output.** `playwright.config.ts` pipes the dev
 * server through `tee e2e-server.log`, and this reads that file. So it needs a
 * server Playwright started: against a server left running under
 * `reuseExistingServer`, the file is stale or absent, and these fail saying no
 * line arrived rather than passing on nothing.
 *
 * It sends requests only, with no browser, so it runs in one project: the log
 * is shared, and a second project would add load and no evidence.
 */
const SERVER_LOG = path.resolve(__dirname, "../../../e2e-server.log");

const REQUEST_FAILED = "request_failed";

/** 🧊 U+1F9CA, percent-encoded, as in `handle-url.spec.ts`. */
const ICE = "%F0%9F%A7%8A";
/** U+FE0F: a trailing variation selector, which `[handle]` 308s away. */
const VS16 = "%EF%B8%8F";
const NON_CANONICAL = `/${ICE}${ICE}${ICE}${VS16}`;

type LogLine = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is LogLine {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rawLog(): string {
  try {
    return readFileSync(SERVER_LOG, "utf8");
  } catch {
    return "";
  }
}

/**
 * Every JSON object written as a line of the server's output. Turbo prefixes
 * each line with its task name, so the object is read from the first `{`.
 */
function jsonLines(): LogLine[] {
  const lines: LogLine[] = [];
  for (const raw of rawLog().split("\n")) {
    const start = raw.indexOf("{");
    if (start === -1) continue;
    try {
      const parsed: unknown = JSON.parse(raw.slice(start));
      if (isRecord(parsed)) lines.push(parsed);
    } catch {
      // Next.js's own print of an error, or a build line: not a structured line.
    }
  }
  return lines;
}

function failuresFor(id: string): LogLine[] {
  return jsonLines().filter(
    (line) => line.event === REQUEST_FAILED && line.correlationId === id,
  );
}

/** Request `target` without following redirects; its status and its id. */
async function send(
  request: APIRequestContext,
  target: string,
): Promise<{ status: number; id: string }> {
  const response = await request.get(target, { maxRedirects: 0 });
  const id = response.headers()["x-correlation-id"] ?? "";
  expect(id, `${target} answered without an x-correlation-id`).not.toBe("");
  return { status: response.status(), id };
}

/** Wait until the server has written a failure line for `id`. */
async function expectFailureLogged(id: string): Promise<void> {
  await expect
    .poll(() => failuresFor(id).length, {
      message: `no ${REQUEST_FAILED} line for ${id} in ${SERVER_LOG}`,
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
}

test.beforeEach(({ browserName: _browserName }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "The server log is shared, so one project reads it.",
  );
});

test("a render error writes exactly one request_failed line, with the response's correlation id and no values", async ({
  request,
}) => {
  const { status, id } = await send(request, "/test-only-error");
  expect(status).toBe(500);

  await expectFailureLogged(id);
  // Leave a duplicate line time to arrive before counting.
  await new Promise((resolve) => setTimeout(resolve, 1_000));

  const lines = failuresFor(id);
  expect(lines).toEqual([
    { event: REQUEST_FAILED, correlationId: id, error: { name: "Error" } },
  ]);
  expect(JSON.stringify(lines)).not.toContain(TEST_ERROR_MESSAGE);
});

test("404s, 308s, redirects and notFound() write no failure line", async ({
  request,
}) => {
  const answers = [
    ["an unmatched path", "/no/such/page", 404],
    ["notFound() from the Handle route", "/abc", 404],
    ["permanentRedirect() to the canonical Handle", NON_CANONICAL, 308],
    ["redirect() from a bare /find", "/find", 307],
  ] as const;

  const sent: { name: string; id: string }[] = [];
  for (const [name, target, expected] of answers) {
    const { status, id } = await send(request, target);
    expect(status, name).toBe(expected);
    sent.push({ name, id });
  }

  // A real failure, sent last. Once its line is written, any line the answers
  // above would have written, in the same process, has been written too.
  const sentinel = await send(request, "/test-only-error");
  await expectFailureLogged(sentinel.id);

  // Only the request error's own line counts. A route may log an unrelated
  // failure of its own, such as an availability read with no database.
  for (const { name, id } of sent) {
    expect(failuresFor(id), `${name} wrote a ${REQUEST_FAILED} line`).toEqual(
      [],
    );
  }
});

test("Next.js still prints the error itself, and no structured line repeats its message", async ({
  request,
}) => {
  const { id } = await send(request, "/test-only-error");
  await expectFailureLogged(id);

  const repeating = jsonLines().filter((line) =>
    JSON.stringify(line).includes(TEST_ERROR_MESSAGE),
  );
  expect(repeating).toEqual([]);
  expect(rawLog()).toContain(TEST_ERROR_MESSAGE);
});
