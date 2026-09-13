import { expect, test, type BrowserContext } from "@playwright/test";
import en from "../../../packages/shared/messages/en.json";
import { checkPage, PAGE_RULES } from "./support/axe";
import {
  seedClaimedHandle,
  sessionCookieFor,
  type SessionCookie,
} from "./support/seed";

/**
 * Account deletion, end to end against the real database
 * ([#195](https://github.com/joshstothard/3moji/issues/195)).
 *
 * 1. An owner reaches the account page from the signed-in indicator.
 * 2. Deleting — with JavaScript switched off — lands on `/` signed out; the old
 *    session cookie reads as signed out; the Profile no longer resolves as
 *    claimed; and somebody else can claim the same Handle immediately.
 * 3. A submission without the confirmation word deletes nothing.
 * 4. A signed-out visitor is sent to sign in.
 * 5. The page passes axe.
 *
 * Sessions come from `sessionCookieFor`, never the sign-in form, which is rate
 * limited per client (`signed-in-state.spec.ts` says why).
 */

const menuCopy = en.AccountMenu;
const copy = en.AccountPage;
const builderCopy = en.HandleBuilder;

async function useSession(
  context: BrowserContext,
  baseURL: string | undefined,
  cookies: readonly SessionCookie[],
): Promise<void> {
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

test("an owner reaches the account page from the signed-in indicator", async ({
  page,
  context,
  baseURL,
}) => {
  const owner = await seedClaimedHandle();
  await useSession(context, baseURL, await sessionCookieFor(owner.credentials));

  await page.goto("/");
  const navigation = page.getByRole("navigation");
  await navigation
    .getByRole("button", { name: menuCopy.toggle, exact: true })
    .click();
  await navigation
    .getByRole("link", { name: menuCopy.account, exact: true })
    .click();

  await expect.poll(() => new URL(page.url()).pathname).toBe("/account");
  await expect(
    page.getByRole("heading", { level: 1, name: copy.heading }),
  ).toBeVisible();
  // Scoped to the page: the navbar's toggle shows the same emoji beside it.
  await expect(
    page.getByRole("main").getByText(owner.key, { exact: true }),
  ).toBeVisible();
});

test("the account page passes axe", async ({ page, context, baseURL }) => {
  const owner = await seedClaimedHandle();
  await useSession(context, baseURL, await sessionCookieFor(owner.credentials));

  await page.goto("/account?error=confirm");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    copy.errorConfirm,
  );

  const report = await checkPage(page);
  expect(report.violations).toEqual([]);
  expect(report.incomplete).toEqual([]);
  expect(report.passed).toEqual(
    expect.arrayContaining([...PAGE_RULES, "label", "button-name", "list"]),
  );
});

test.describe("with JavaScript switched off", () => {
  test.use({ javaScriptEnabled: false });

  test("deleting signs the owner out, frees the Handle, and lets somebody else claim it at once", async ({
    page,
    context,
    baseURL,
    request,
  }) => {
    const owner = await seedClaimedHandle();
    const cookies = await sessionCookieFor(owner.credentials);
    await useSession(context, baseURL, cookies);

    const before = await request.get("/api/viewer", {
      headers: { cookie: cookieHeader(cookies) },
    });
    expect(await before.json()).toMatchObject({ state: "owner" });

    await page.goto("/account");
    await page
      .getByRole("textbox", {
        name: `${copy.confirmLabel} ${copy.confirmWord}`,
      })
      .fill(copy.confirmWord);
    await page.getByRole("button", { name: copy.submit }).click();

    await expect.poll(() => new URL(page.url()).pathname).toBe("/");

    // The browser's own cookie is gone, and the old one, replayed, is nobody.
    const browserCookies = await context.cookies();
    expect(
      browserCookies.filter((cookie) =>
        cookies.some((old) => old.name === cookie.name),
      ),
    ).toEqual([]);
    const after = await request.get("/api/viewer", {
      headers: { cookie: cookieHeader(cookies) },
    });
    expect(await after.json()).toEqual({ state: "signed-out" });

    // The Profile no longer resolves as claimed: the builder offers it.
    const profile = await request.get(owner.path);
    expect(profile.status()).toBe(200);
    const body = await profile.text();
    expect(body).toContain(builderCopy.stateAvailable);
    expect(body).not.toContain(owner.profile.displayName);

    // And somebody else claims exactly that Handle, straight away.
    const next = await seedClaimedHandle({ chooseEmoji: () => owner.emoji });
    expect(next.key).toBe(owner.key);
    expect(next.credentials.email).not.toBe(owner.credentials.email);
  });

  test("a submission without the confirmation word deletes nothing", async ({
    page,
    context,
    baseURL,
    request,
  }) => {
    const owner = await seedClaimedHandle();
    const cookies = await sessionCookieFor(owner.credentials);
    await useSession(context, baseURL, cookies);

    await page.goto("/account");
    await page
      .getByRole("textbox", {
        name: `${copy.confirmLabel} ${copy.confirmWord}`,
      })
      .fill("yes");
    await page.getByRole("button", { name: copy.submit }).click();

    await expect(page.getByRole("alert")).toHaveText(copy.errorConfirm);
    expect(new URL(page.url()).pathname).toBe("/account");

    const viewer = await request.get("/api/viewer", {
      headers: { cookie: cookieHeader(cookies) },
    });
    expect(await viewer.json()).toMatchObject({
      state: "owner",
      key: owner.key,
    });
    const profile = await request.get(owner.path);
    expect(await profile.text()).toContain(owner.profile.displayName);
  });

  test("a signed-out visitor is sent to sign in", async ({ page }) => {
    await page.goto("/account");

    await expect.poll(() => new URL(page.url()).pathname).toBe("/sign-in");
  });
});
