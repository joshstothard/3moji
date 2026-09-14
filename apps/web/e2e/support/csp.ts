import {
  expect,
  type APIResponse,
  type Page,
  type Response,
} from "@playwright/test";

/**
 * Content Security Policy checks for rendered pages
 * ([#205](https://github.com/joshstothard/3moji/issues/205)).
 *
 * A refused script or style is silent to every other assertion until something
 * it would have done fails to happen, so violations are collected from two
 * places and asserted empty: the `securitypolicyviolation` event, and Chromium's
 * console error, which is the only one of the two a page with JavaScript
 * switched off still produces (a refused form submission, for one).
 *
 * The listener is installed with Playwright's `addInitScript` and reports
 * through `exposeFunction`, both of which are driven over the DevTools protocol
 * and so are not themselves subject to the page's policy — which is also why
 * `@axe-core/playwright`'s injection keeps working under it.
 */

/** A policy's nonce, from its `'nonce-…'` source. */
export function nonceOf(policy: string | undefined): string | undefined {
  return /'nonce-([A-Za-z0-9+/]+={0,2})'/.exec(policy ?? "")?.[1];
}

/** The source list of one directive, or `undefined` when it is absent. */
export function directiveOf(
  policy: string | undefined,
  name: string,
): readonly string[] | undefined {
  const directive = (policy ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  return directive?.split(/\s+/).slice(1);
}

export interface CspWatch {
  /** Every violation reported so far, as one line each. */
  readonly violations: () => readonly string[];
}

const BINDING = "__report205CspViolation";

/** Starts collecting violations for `page`. Call before the first `goto`. */
export async function watchCspViolations(page: Page): Promise<CspWatch> {
  const seen: string[] = [];

  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /Content[ -]Security[ -]Policy/i.test(message.text())
    ) {
      seen.push(`console: ${message.text()}`);
    }
  });

  await page.exposeFunction(BINDING, (line: string) => {
    seen.push(`event: ${line}`);
  });
  await page.addInitScript((binding: string) => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const report = (
        window as unknown as Record<
          string,
          ((line: string) => void) | undefined
        >
      )[binding];
      if (report !== undefined) {
        report(
          `${event.effectiveDirective} refused ${event.blockedURI || "inline"} on ${event.documentURI}`,
        );
      }
    });
  }, BINDING);

  return { violations: () => [...seen] };
}

/**
 * Asserts an HTML response carries a nonce policy and that **every** `<script>`
 * in the HTML carries that nonce. A page served prerendered fails the second
 * half: it has scripts, and none of them has a nonce.
 */
export async function expectNoncedHtml(
  response: Response | APIResponse | null,
): Promise<string> {
  expect(response, "a response").not.toBeNull();
  const headers = response?.headers() ?? {};
  const policy = headers["content-security-policy"];
  const nonce = nonceOf(policy);
  expect(nonce, `a nonce policy on ${response?.url() ?? ""}`).toBeDefined();

  const body = (await response?.text()) ?? "";
  const scripts = [...body.matchAll(/<script\b[^>]*>/g)].map(
    (match) => match[0],
  );
  expect(scripts.length, "the page has scripts to check").toBeGreaterThan(0);
  expect(
    scripts.filter((tag) => !tag.includes(`nonce="${nonce ?? ""}"`)),
    "scripts without this request's nonce",
  ).toEqual([]);
  return policy ?? "";
}

/**
 * Waits for the page to have loaded and gone quiet, so a script refused late
 * — a chunk `'strict-dynamic'` loads, a style set after hydration — has had
 * the chance to report, then asserts nothing was refused.
 */
export async function expectNoViolations(
  page: Page,
  watch: CspWatch,
): Promise<void> {
  await page.waitForLoadState("networkidle");
  expect(watch.violations()).toEqual([]);
}

/**
 * Asserts React has hydrated the document: it tags each element it owns with a
 * `__reactFiber$…` property, and a page whose scripts were refused has none.
 * Visible markup proves nothing here, because the server rendered all of it.
 */
export async function expectHydrated(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Object.keys(document.body).some((key) =>
            key.startsWith("__reactFiber$"),
          ),
        ),
      { message: "React hydrated the page" },
    )
    .toBe(true);
}
