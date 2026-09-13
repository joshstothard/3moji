import { isDeployed } from "./deployment";

/**
 * The switch for `/test-only-error` (#203).
 *
 * The branded error page renders only when something actually throws, and the
 * quality bar is that it passes axe and contrast **in a real browser, in both
 * Playwright projects** — which jsdom cannot give, since it paints no colour.
 * So CI's E2E job sets `TEST_ERROR_ROUTE=enabled`, and `app/test-only-error`
 * throws; everywhere else that page is `notFound()`.
 *
 * It follows `TEST_EMAIL_SENDER`'s rules (#151): **one spelled-out value**, so a
 * typo or `true` cannot switch it on, and **refused on any deployment**, so a
 * misconfigured production environment gets a 404 rather than a route that
 * fails on request. Refusing here is quiet rather than a startup failure,
 * because the safe answer — the page does not exist — is also the normal one.
 */

/** The one value that switches the route on. */
export const TEST_ERROR_ROUTE_ENABLED = "enabled";

/**
 * What the page throws. A sentinel, so the E2E spec can assert it never
 * reaches the screen; it quotes nothing about any request.
 */
export const TEST_ERROR_MESSAGE =
  "test-only-error: thrown on purpose so a test run can see the error page";

export function isTestErrorRouteEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return env.TEST_ERROR_ROUTE === TEST_ERROR_ROUTE_ENABLED && !isDeployed(env);
}
