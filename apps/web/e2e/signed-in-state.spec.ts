import { randomInt } from "node:crypto";

import {
  expect,
  test,
  type APIResponse,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import en from "../../../packages/shared/messages/en.json";
import { checkPage } from "./support/axe";
import {
  seedClaimedHandle,
  sessionCookieFor,
  type SeededHandle,
  type SessionCookie,
} from "./support/seed";

/**
 * The signed-in state, end to end
 * ([#193](https://github.com/joshstothard/3moji/issues/193)).
 *
 * The indicator is a client island in the navbar that asks `GET /api/viewer`
 * who is looking, so no page reads the session. Each acceptance criterion has
 * a test below:
 *
 * 1. an owner sees an indicator with links to their own Profile and edit page,
 *    on every page;
 * 2. a signed-out visitor sees a sign-in link instead, and nobody is shown
 *    another person's links;
 * 3. the public Profile's response is the same bytes and the same headers for
 *    a signed-out visitor, a signed-in stranger and the owner;
 * 4. both states pass axe, and the indicator works with the keyboard alone.
 *
 * **Sessions come from `sessionCookieFor`, not the form**, except in the one
 * test that is about the form, which sends its own client address. The form
 * is rate limited per client, and signing in through it for every check would
 * spend a budget other specs share.
 */

const copy = en.AccountMenu;
const claimCopy = en.Claim;

async function signInAs(
  context: BrowserContext,
  baseURL: string | undefined,
  seeded: SeededHandle,
): Promise<void> {
  const cookies = await sessionCookieFor(seeded.credentials);
  await context.addCookies(
    cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      url: baseURL ?? "http://localhost:3000",
    })),
  );
}

function cookieHeader(cookies: readonly SessionCookie[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

function navigation(page: Page): Locator {
  return page.getByRole("navigation");
}

function signInLink(page: Page): Locator {
  return navigation(page).getByRole("link", { name: copy.signIn, exact: true });
}

function toggleIn(page: Page): Locator {
  return navigation(page).getByRole("button", {
    name: copy.toggle,
    exact: true,
  });
}

function menuLink(page: Page, name: string): Locator {
  return navigation(page).getByRole("link", { name, exact: true });
}

async function navHrefs(page: Page): Promise<string[]> {
  return navigation(page)
    .getByRole("link")
    .evaluateAll((links) =>
      links.map((link) => link.getAttribute("href") ?? ""),
    );
}

test("a signed-out visitor sees a sign-in link on every page, and nobody's links", async ({
  page,
}) => {
  const seeded = await seedClaimedHandle();

  for (const path of ["/", seeded.path, "/sign-in", "/find"]) {
    await page.goto(path);

    await expect(
      signInLink(page),
      `the sign-in link on ${path}`,
    ).toHaveAttribute("href", "/sign-in");
    await expect(toggleIn(page)).toHaveCount(0);

    const hrefs = await navHrefs(page);
    expect(hrefs, `links in the navbar on ${path}`).not.toContain(seeded.path);
    expect(hrefs.some((href) => href.endsWith("/edit"))).toBe(false);
  }
});

test("a signed-in owner sees their own Profile and edit links on every page, and they work", async ({
  page,
  context,
  baseURL,
}) => {
  const owner = await seedClaimedHandle();
  const other = await seedClaimedHandle();
  await signInAs(context, baseURL, owner);

  for (const path of [
    "/",
    owner.path,
    other.path,
    "/sign-in",
    `${owner.path}/edit`,
  ]) {
    await page.goto(path);

    const toggle = toggleIn(page);
    await expect(toggle, `the indicator on ${path}`).toBeVisible();
    await expect(signInLink(page)).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(menuLink(page, copy.yourProfile)).toHaveAttribute(
      "href",
      owner.path,
    );
    await expect(menuLink(page, copy.editProfile)).toHaveAttribute(
      "href",
      `${owner.path}/edit`,
    );
    expect(await navHrefs(page), `links on ${path}`).not.toContain(other.path);
  }

  await page.goto("/");
  await toggleIn(page).click();
  await menuLink(page, copy.editProfile).click();
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe(`${owner.path}/edit`);
  await expect(
    page.getByRole("heading", { level: 1 }),
    "the edit page opened for its owner",
  ).toBeVisible();
});

test("a signed-in stranger on somebody's Profile is shown only their own links", async ({
  page,
  context,
  baseURL,
}) => {
  const owner = await seedClaimedHandle();
  const stranger = await seedClaimedHandle();
  await signInAs(context, baseURL, stranger);

  await page.goto(owner.path);
  await toggleIn(page).click();

  await expect(menuLink(page, copy.yourProfile)).toHaveAttribute(
    "href",
    stranger.path,
  );
  const hrefs = await navHrefs(page);
  expect(hrefs).not.toContain(owner.path);
  expect(hrefs).not.toContain(`${owner.path}/edit`);
});

test("the viewer route answers only the session's own Account, and is never stored", async ({
  playwright,
  baseURL,
}) => {
  const owner = await seedClaimedHandle();
  const stranger = await seedClaimedHandle();

  const ask = async (cookie: string | undefined): Promise<APIResponse> => {
    const context = await playwright.request.newContext({
      baseURL,
      ...(cookie === undefined ? {} : { extraHTTPHeaders: { cookie } }),
    });
    return context.get("/api/viewer", { maxRedirects: 0 });
  };

  const anonymous = await ask(undefined);
  expect(anonymous.status()).toBe(200);
  expect(await anonymous.json()).toEqual({ state: "signed-out" });
  expect(anonymous.headers()["cache-control"]).toBe("private, no-store");

  const asStranger = await ask(
    cookieHeader(await sessionCookieFor(stranger.credentials)),
  );
  const body = await asStranger.text();
  expect(JSON.parse(body)).toEqual({
    state: "owner",
    key: stranger.key,
    encoded: stranger.path.slice(1),
  });
  expect(body).not.toContain(owner.path.slice(1));
  expect(body).not.toContain(stranger.credentials.email);
  expect(asStranger.headers()["cache-control"]).toBe("private, no-store");
});

test("signing in through the form shows the indicator without reloading the page", async ({
  page,
}) => {
  const seeded = await seedClaimedHandle();
  // Its own client address, so this one form sign-in is not counted against
  // anybody else's allowance. Outside Vercel this header is client-writable —
  // `lib/client-address.ts` says so — which is what makes it usable here.
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `198.51.100.${String(randomInt(1, 255))}`,
  });

  await page.goto("/sign-in");
  await expect(signInLink(page)).toBeVisible();
  await page.evaluate(() => {
    (window as Window & { signedInStateMarker?: true }).signedInStateMarker =
      true;
  });

  await page
    .getByLabel(claimCopy.signInEmailLabel)
    .fill(seeded.credentials.email);
  await page
    .getByLabel(claimCopy.signInPasswordLabel)
    .fill(seeded.credentials.password);
  await page.getByRole("button", { name: claimCopy.signInSubmit }).click();

  await expect(page).not.toHaveURL(/\/sign-in/);
  await expect(toggleIn(page)).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { signedInStateMarker?: true })
          .signedInStateMarker === true,
    ),
    "the page reloaded instead of the indicator updating",
  ).toBe(true);
});

test("the public Profile is the same bytes and headers for a signed-out visitor, a stranger and its owner", async ({
  playwright,
  baseURL,
}) => {
  const owner = await seedClaimedHandle();
  const stranger = await seedClaimedHandle();
  const [ownerCookies, strangerCookies] = await Promise.all([
    sessionCookieFor(owner.credentials),
    sessionCookieFor(stranger.credentials),
  ]);

  /**
   * The body with `next dev`'s per-request id blanked, and nothing else.
   *
   * `next dev` writes `self.__next_r="<random>"` into a dev-only inline script,
   * so two requests from the same visitor can differ by that token alone.
   * `next start` does not emit it. **At most one occurrence is replaced**, so
   * it cannot hide any other difference.
   */
  const normalised = async (response: APIResponse): Promise<string> => {
    const body = (await response.body()).toString("utf8");
    const tokens = body.match(/self\.__next_r="[^"]*"/g) ?? [];
    expect(tokens.length, "more than one dev request id").toBeLessThanOrEqual(
      1,
    );
    return body.replace(/self\.__next_r="[^"]*"/, 'self.__next_r=""');
  };

  const asked = async (cookie: string | undefined): Promise<APIResponse> => {
    const context = await playwright.request.newContext({
      baseURL,
      ...(cookie === undefined ? {} : { extraHTTPHeaders: { cookie } }),
    });
    const response = await context.get(owner.path, { maxRedirects: 0 });
    await response.body();
    return response;
  };

  // Warm the route and discard the answer: `next dev` can render a route's
  // first request differently from its second while it is still compiling,
  // for no reason to do with who asked.
  await asked(undefined);

  // The control: two signed-out requests. If the page were not deterministic
  // on its own, this is where it would show, rather than as a false finding
  // about the session.
  const control = await asked(undefined);
  const again = await asked(undefined);
  const asStranger = await asked(cookieHeader(strangerCookies));
  const asOwner = await asked(cookieHeader(ownerCookies));

  const controlBody = await normalised(control);
  expect(control.status()).toBe(200);
  expect((await normalised(again)) === controlBody, "control").toBe(true);
  // An owner-only link in the page itself would be the leak this guards.
  expect(controlBody).not.toContain(`${owner.path}/edit`);
  expect(controlBody).not.toContain(copy.editProfile);

  for (const [who, response] of [
    ["a signed-in stranger", asStranger],
    ["the signed-in owner", asOwner],
  ] as const) {
    expect(response.status(), who).toBe(200);
    expect(
      (await normalised(response)) === controlBody,
      `the Profile's HTML differs for ${who}`,
    ).toBe(true);
    for (const header of ["cache-control", "vary", "content-type"]) {
      expect(response.headers()[header], `${header} for ${who}`).toBe(
        control.headers()[header],
      );
    }
    expect(response.headers()["set-cookie"], who).toBeUndefined();
  }
  // Nothing about who asked may make a shared cache key on the session.
  expect(control.headers().vary ?? "").not.toMatch(/cookie/i);
});

test("both states of the indicator pass axe", async ({
  page,
  context,
  baseURL,
}) => {
  const owner = await seedClaimedHandle();

  await page.goto(owner.path);
  await expect(signInLink(page)).toBeVisible();
  const signedOut = await checkPage(page);
  expect(signedOut.violations).toEqual([]);
  expect(signedOut.incomplete).toEqual([]);
  expect(signedOut.passed).toEqual(expect.arrayContaining(["link-name"]));

  await signInAs(context, baseURL, owner);
  await page.goto(owner.path);
  await toggleIn(page).click();
  await expect(menuLink(page, copy.editProfile)).toBeVisible();
  const signedIn = await checkPage(page);
  expect(signedIn.violations).toEqual([]);
  expect(signedIn.incomplete).toEqual([]);
  expect(signedIn.passed).toEqual(
    expect.arrayContaining(["button-name", "link-name", "list", "listitem"]),
  );
});

/**
 * **Keyboard only** in the tests below: every move is a key press, and a
 * runtime guard records any pointer, mouse or touch event the page receives
 * and requires none — the same guard `keyboard-only.spec.ts` uses, since this
 * file's other tests click and so cannot carry that spec's static one.
 *
 * A focus indicator is a visible outline drawn only while focused, as in
 * `keyboard-only.spec.ts`: box-shadow does not count.
 */
test.describe("with the keyboard alone", () => {
  const POINTER_EVENTS = [
    "pointerdown",
    "pointerup",
    "mousedown",
    "mouseup",
    "touchstart",
    "touchend",
  ] as const;

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((events: readonly string[]) => {
      const seen: string[] = [];
      (window as Window & { pointerEventsSeen?: string[] }).pointerEventsSeen =
        seen;
      for (const name of events) {
        window.addEventListener(name, () => seen.push(name), true);
      }
    }, POINTER_EVENTS);
  });

  test.afterEach(async ({ page }) => {
    const seen = await page.evaluate(
      () =>
        (window as Window & { pointerEventsSeen?: string[] })
          .pointerEventsSeen ?? [],
    );
    expect(seen, "a pointer event reached the page").toEqual([]);
  });

  const MAX_PRESSES = 12;

  async function outlineOf(control: Locator): Promise<boolean> {
    return control.evaluate((element) => {
      const style = getComputedStyle(element);
      return (
        style.outlineStyle !== "none" &&
        style.outlineStyle !== "hidden" &&
        Number.parseFloat(style.outlineWidth) > 0 &&
        !/^transparent$|,\s*0\)$|\/\s*0\)$/.test(style.outlineColor)
      );
    });
  }

  async function expectFocusShownOn(control: Locator): Promise<void> {
    await expect(control).toBeFocused();
    expect(
      await control.evaluate((element) => element.matches(":focus-visible")),
      "focused but not :focus-visible",
    ).toBe(true);
    expect(await outlineOf(control), "focused but draws no outline").toBe(true);
  }

  async function tabTo(page: Page, target: Locator): Promise<void> {
    await expect(target).toBeVisible();
    expect(await outlineOf(target), "an outline before focus").toBe(false);
    for (let presses = 0; presses < MAX_PRESSES; presses += 1) {
      await page.keyboard.press("Tab");
      if (
        await target.evaluate((element) => element === document.activeElement)
      ) {
        await expectFocusShownOn(target);
        return;
      }
    }
    throw new Error(`Tab did not reach the target in ${String(MAX_PRESSES)}.`);
  }

  test("a signed-out visitor reaches the sign-in link and follows it", async ({
    page,
  }) => {
    await page.goto("/");
    const signIn = signInLink(page);

    await tabTo(page, signIn);
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("an owner opens the indicator, moves through its links, closes it, and follows one", async ({
    page,
    context,
    baseURL,
  }) => {
    const owner = await seedClaimedHandle();
    await signInAs(context, baseURL, owner);
    await page.goto("/");
    const toggle = toggleIn(page);

    await tabTo(page, toggle);
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    const profile = menuLink(page, copy.yourProfile);
    const edit = menuLink(page, copy.editProfile);
    await page.keyboard.press("Tab");
    await expectFocusShownOn(profile);
    await page.keyboard.press("Tab");
    await expectFocusShownOn(edit);

    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expectFocusShownOn(toggle);

    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await expectFocusShownOn(profile);
    await page.keyboard.press("Enter");

    await expect.poll(() => new URL(page.url()).pathname).toBe(owner.path);
  });
});
