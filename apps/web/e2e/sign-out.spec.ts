import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
  type PlaywrightWorkerArgs,
} from "@playwright/test";
import en from "../../../packages/shared/messages/en.json";
import {
  seedClaimedHandle,
  sessionCookieFor,
  type SeededHandle,
  type SessionCookie,
} from "./support/seed";

/**
 * Sign-out, end to end ([#194](https://github.com/joshstothard/3moji/issues/194)).
 *
 * Each acceptance criterion has a test below:
 *
 * 1. signing out ends the session — a request carrying the old cookie is
 *    treated as signed out (the session row itself is checked against
 *    Postgres in `packages/core/src/auth/auth.integration.test.ts`);
 * 2. it works with JavaScript switched off and lands on `/` signed out;
 * 3. it is a POST: no GET — to the page, to the form's own address, or to
 *    Better Auth's endpoint — signs anybody out, and a cross-site POST is
 *    refused.
 *
 * **Sessions come from `sessionCookieFor`**, never the rate-limited sign-in
 * form, as in `signed-in-state.spec.ts`.
 */

const copy = en.AccountMenu;
const SESSION_COOKIE = "better-auth.session_token";

type Playwright = PlaywrightWorkerArgs["playwright"];

async function signedInAs(
  context: BrowserContext,
  baseURL: string | undefined,
  seeded: SeededHandle,
): Promise<readonly SessionCookie[]> {
  const cookies = await sessionCookieFor(seeded.credentials);
  await context.addCookies(
    cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      url: baseURL ?? "http://localhost:3000",
    })),
  );
  return cookies;
}

function asCookieHeader(cookies: readonly SessionCookie[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

/** What `GET /api/viewer` says about a request carrying `cookie` and nothing else. */
async function stateFor(
  playwright: Playwright,
  baseURL: string | undefined,
  cookie: string,
): Promise<unknown> {
  const context = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { cookie },
  });
  try {
    const response = await context.get("/api/viewer");
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null && "state" in body
      ? body.state
      : undefined;
  } finally {
    await context.dispose();
  }
}

function signOutButton(page: Page): Locator {
  return page
    .getByRole("navigation")
    .getByRole("button", { name: copy.signOut, exact: true });
}

async function sessionCookieNames(context: BrowserContext): Promise<string[]> {
  return (await context.cookies())
    .map((cookie) => cookie.name)
    .filter((name) => name === SESSION_COOKIE);
}

test("signing out from the indicator ends the session, lands on / and shows the sign-in link", async ({
  page,
  context,
  baseURL,
  playwright,
}) => {
  const owner = await seedClaimedHandle();
  const cookie = asCookieHeader(await signedInAs(context, baseURL, owner));
  expect(await stateFor(playwright, baseURL, cookie)).toBe("owner");

  await page.goto(owner.path);
  const nav = page.getByRole("navigation");
  await nav.getByRole("button", { name: copy.toggle, exact: true }).click();
  await signOutButton(page).click();

  await expect.poll(() => new URL(page.url()).pathname).toBe("/");
  await expect(
    nav.getByRole("link", { name: copy.signIn, exact: true }),
  ).toBeVisible();
  await expect(
    nav.getByRole("button", { name: copy.toggle, exact: true }),
  ).toHaveCount(0);
  expect(await sessionCookieNames(context), "the session cookie").toEqual([]);
  expect(
    await stateFor(playwright, baseURL, cookie),
    "a request carrying the old cookie",
  ).toBe("signed-out");
});

test("signing out on / itself shows the sign-in link without reloading the page", async ({
  page,
  context,
  baseURL,
}) => {
  const owner = await seedClaimedHandle();
  await signedInAs(context, baseURL, owner);

  await page.goto("/");
  const nav = page.getByRole("navigation");
  await nav.getByRole("button", { name: copy.toggle, exact: true }).click();
  await page.evaluate(() => {
    (window as Window & { signOutMarker?: true }).signOutMarker = true;
  });
  await signOutButton(page).click();

  await expect(
    nav.getByRole("link", { name: copy.signIn, exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { signOutMarker?: true }).signOutMarker === true,
    ),
    "the page reloaded instead of the indicator updating",
  ).toBe(true);
});

test.describe("with JavaScript switched off", () => {
  test.use({ javaScriptEnabled: false });

  /**
   * The `<noscript>` sign-out form as a browser without JavaScript submits
   * it: its method, its resolved address, and every field it would send.
   * Read with `evaluate`, which Playwright runs even when the page's own
   * scripts are off.
   */
  async function noscriptForm(page: Page): Promise<{
    readonly method: string;
    readonly action: string;
    readonly fields: readonly (readonly [string, string])[];
  }> {
    const button = signOutButton(page);
    await expect(button).toBeVisible();
    return button.evaluate((element) => {
      const form = (element as HTMLButtonElement).form;
      if (form === null) throw new Error("the sign-out button has no form");
      return {
        method: form.method,
        action: form.action,
        fields: [...new FormData(form).entries()].map(
          ([name, value]) =>
            [name, typeof value === "string" ? value : value.name] as const,
        ),
      };
    });
  }

  /** Posts the `<noscript>` form's exact fields, carrying `cookie`, as if from `origin`. */
  async function submitForm(
    playwright: Playwright,
    baseURL: string | undefined,
    cookie: string,
    form: Awaited<ReturnType<typeof noscriptForm>>,
    origin: string,
  ): Promise<void> {
    const context = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { cookie },
    });
    try {
      await context.post(form.action, {
        headers: { origin },
        multipart: Object.fromEntries(form.fields),
        maxRedirects: 0,
      });
    } finally {
      await context.dispose();
    }
  }

  test("the navbar's sign-out form ends the session and lands on / signed out", async ({
    page,
    context,
    baseURL,
    playwright,
  }) => {
    const owner = await seedClaimedHandle();
    const cookie = asCookieHeader(await signedInAs(context, baseURL, owner));

    await page.goto(owner.path);
    expect((await noscriptForm(page)).method).toBe("post");
    await signOutButton(page).click();

    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    expect(await sessionCookieNames(context), "the session cookie").toEqual([]);
    expect(
      await stateFor(playwright, baseURL, cookie),
      "a request carrying the old cookie",
    ).toBe("signed-out");
  });

  test("a GET cannot sign anybody out: not the page, not the form's own address, not Better Auth's endpoint", async ({
    page,
    baseURL,
    playwright,
  }) => {
    const owner = await seedClaimedHandle();
    const cookie = asCookieHeader(await sessionCookieFor(owner.credentials));

    await page.goto("/");
    const form = await noscriptForm(page);
    const asQuery = new URL(form.action);
    for (const [name, value] of form.fields) {
      asQuery.searchParams.set(name, value);
    }

    const context = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { cookie },
    });
    try {
      for (const target of [
        "/",
        owner.path,
        asQuery.toString(),
        "/api/auth/sign-out",
      ]) {
        await context.get(target, { maxRedirects: 0 });
        expect(
          await stateFor(playwright, baseURL, cookie),
          `after GET ${target}`,
        ).toBe("owner");
      }
    } finally {
      await context.dispose();
    }

    // The control: the same session does end when the form is POSTed, so the
    // GETs above survived because they were GETs, not because nothing works.
    await submitForm(
      playwright,
      baseURL,
      cookie,
      form,
      new URL(form.action).origin,
    );
    expect(
      await stateFor(playwright, baseURL, cookie),
      "after POSTing the form itself",
    ).toBe("signed-out");
  });

  test("a cross-site POST of the form is refused, and the same POST from the site itself signs out", async ({
    page,
    baseURL,
    playwright,
  }) => {
    const owner = await seedClaimedHandle();
    const cookie = asCookieHeader(await sessionCookieFor(owner.credentials));

    await page.goto("/");
    const form = await noscriptForm(page);

    await submitForm(
      playwright,
      baseURL,
      cookie,
      form,
      "https://attacker.example",
    );
    expect(
      await stateFor(playwright, baseURL, cookie),
      "after a POST from another site",
    ).toBe("owner");

    // The control: the identical request from the site's own origin works,
    // so the refusal above was the origin check and not a malformed request.
    await submitForm(
      playwright,
      baseURL,
      cookie,
      form,
      new URL(form.action).origin,
    );
    expect(
      await stateFor(playwright, baseURL, cookie),
      "after the same POST from the site itself",
    ).toBe("signed-out");
  });
});
