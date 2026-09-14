import { randomInt, randomUUID } from "node:crypto";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  canonicalise,
  curatedEmojiSet,
  HANDLE_LENGTH,
  isReservedHandle,
} from "@template/core";
import en from "../../../packages/shared/messages/en.json";
import { unclaimedSeveralHandleKeys } from "./support/aliases";
import {
  expectHydrated,
  expectNoncedHtml,
  expectNoViolations,
  watchCspViolations,
} from "./support/csp";
import { pickEmojiByName } from "./support/picker";
import {
  seedClaimedHandle,
  sessionCookieFor,
  type SeededHandle,
} from "./support/seed";

/**
 * Every page type works under the Content Security Policy
 * ([#205](https://github.com/joshstothard/3moji/issues/205)).
 *
 * Each page is loaded in a real browser with violations collected from the
 * first byte (`support/csp.ts`), and is asserted to carry this request's nonce
 * on every script, to hydrate, and to report nothing refused. Forms are
 * submitted with JavaScript switched off too, because that is the only way
 * `form-action` is exercised: with JavaScript on, a server action is a `fetch`.
 *
 * **This runs `next dev`, and so the development policy**, which adds
 * `'unsafe-eval'` and inline styles. The production policy is proved against a
 * production build by `content-security-policy.production.ts`.
 *
 * Sessions come from `sessionCookieFor`, never the rate-limited sign-in form.
 */

const builderCopy = en.HandleBuilder;
const menuCopy = en.AccountMenu;
const accountCopy = en.AccountPage;
const resetCopy = en.PasswordReset;
const claimCopy = en.Claim;

async function signIn(
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

/** The picker has no search box since #253: open the category, press the emoji. */
async function pick(page: Page, name: string): Promise<void> {
  await pickEmojiByName(page, name);
}

test("every HTML response carries the policy and the four static security headers", async ({
  request,
}) => {
  const response = await request.get("/");
  const headers = response.headers();

  expect(headers["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  expect(headers["strict-transport-security"]).toBe(
    "max-age=63072000; includeSubDomains",
  );
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-frame-options"]).toBe("DENY");
});

test("the builder hydrates, reads availability and celebrates a rare triple, with nothing refused", async ({
  page,
}) => {
  const watch = await watchCspViolations(page);

  await expectNoncedHtml(await page.goto("/"));
  await expectHydrated(page);
  // 🧊🧊🧊: available in the shared E2E database (rare-handle.spec.ts), so the
  // server action answers and the celebration sets its inline animation delay.
  for (let picked = 0; picked < 3; picked += 1) {
    await pick(page, "ice cube");
  }
  await expect(page.getByText(builderCopy.stateAvailable)).toBeVisible();
  await expect(
    page.getByText(builderCopy.rareBadge, { exact: true }),
  ).toBeVisible();

  await expectNoViolations(page, watch);
});

test("a Profile renders and hydrates with nothing refused", async ({
  page,
}) => {
  const seeded = await seedClaimedHandle();
  const watch = await watchCspViolations(page);

  await expectNoncedHtml(await page.goto(seeded.path));
  await expect(
    page.getByRole("heading", { level: 2, name: seeded.profile.displayName }),
  ).toBeVisible();
  await expectHydrated(page);

  await expectNoViolations(page, watch);
});

test("the edit page and the account page render for their owner with nothing refused", async ({
  page,
  context,
  baseURL,
}) => {
  const seeded = await seedClaimedHandle();
  await signIn(context, baseURL, seeded);
  const watch = await watchCspViolations(page);

  const edit = await page.goto(`${seeded.path}/edit`);
  expect(edit?.status()).toBe(200);
  await expectNoncedHtml(edit);
  await expect(page).toHaveURL(new RegExp(`${seeded.path}/edit$`));
  await expect(page.getByRole("textbox").first()).toBeVisible();
  await expectHydrated(page);

  const account = await page.goto("/account");
  expect(account?.status()).toBe(200);
  await expectNoncedHtml(account);
  await expect(page).toHaveURL(/\/account$/);
  await expect(
    page.getByRole("button", { name: accountCopy.submit }),
  ).toBeVisible();
  await expectHydrated(page);

  await expectNoViolations(page, watch);
});

for (const [name, path, status] of [
  ["sign-in", "/sign-in", 200],
  ["the reset request form", "/reset-password", 200],
  ["a reset link", "/reset-password/not-a-real-reset-token", 200],
  ["a lookup that finds nothing", "/find?q=zzqx%20zzqx%20zzqx", 200],
  ["the privacy notice", "/privacy", 200],
  ["the terms of use", "/terms", 200],
  ["the 404", "/no/such/page", 404],
  ["the error page", "/test-only-error", 500],
] as const) {
  test(`${name} renders and hydrates with nothing refused`, async ({
    page,
  }) => {
    const watch = await watchCspViolations(page);

    const response = await page.goto(path);

    expect(response?.status()).toBe(status);
    await expectNoncedHtml(response);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expectHydrated(page);
    await expectNoViolations(page, watch);
  });
}

test("the Open Graph image routes still answer with a PNG", async ({
  request,
}) => {
  const seeded = await seedClaimedHandle();

  for (const path of ["/og-image", `${seeded.path}/og-image`]) {
    const response = await request.get(path);

    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"], path).toBe("image/png");
  }
});

test("signing out from the indicator works with nothing refused", async ({
  page,
  context,
  baseURL,
}) => {
  const seeded = await seedClaimedHandle();
  await signIn(context, baseURL, seeded);
  const watch = await watchCspViolations(page);

  await page.goto(seeded.path);
  await expectHydrated(page);
  const nav = page.getByRole("navigation").first();
  await nav.getByRole("button", { name: menuCopy.toggle, exact: true }).click();
  await nav
    .getByRole("button", { name: menuCopy.signOut, exact: true })
    .click();

  await expect(
    nav.getByRole("link", { name: menuCopy.signIn, exact: true }),
  ).toBeVisible();
  await expectNoViolations(page, watch);
});

/**
 * `form-action 'self'` governs a real form submission and the redirect that
 * answers it, which only happens with JavaScript switched off.
 */
test.describe("forms, with JavaScript switched off", () => {
  test.use({ javaScriptEnabled: false });

  test("the navbar's sign-out form submits and lands on / with nothing refused", async ({
    page,
    context,
    baseURL,
  }) => {
    const seeded = await seedClaimedHandle();
    await signIn(context, baseURL, seeded);
    const watch = await watchCspViolations(page);

    // Start away from `/`, so arriving there proves the form navigated: a
    // refused submission leaves the page where it was.
    await page.goto(seeded.path);
    await page
      .getByRole("button", { name: menuCopy.signOut, exact: true })
      .click();

    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    // The `<noscript>` form is in every page's shell, signed in or not, so the
    // proof the submission worked is the session cookie, as in sign-out.spec.ts.
    const cookies = await context.cookies();
    expect(
      cookies.filter((cookie) => cookie.name.includes("session_token")),
      "the session cookie",
    ).toEqual([]);
    await expectNoViolations(page, watch);
  });

  test("the account deletion form submits and lands on / with nothing refused", async ({
    page,
    context,
    baseURL,
    request,
  }) => {
    const seeded = await seedClaimedHandle();
    await signIn(context, baseURL, seeded);
    const watch = await watchCspViolations(page);

    await page.goto("/account");
    await page
      .getByRole("textbox", {
        name: `${accountCopy.confirmLabel} ${accountCopy.confirmWord}`,
      })
      .fill(accountCopy.confirmWord);
    await page.getByRole("button", { name: accountCopy.submit }).click();

    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    const profile = await request.get(seeded.path);
    expect(await profile.text()).not.toContain(seeded.profile.displayName);
    await expectNoViolations(page, watch);
  });

  test("the password reset request form submits with nothing refused", async ({
    page,
  }) => {
    // The request form is limited per client; a random address keeps this
    // test out of every other spec's bucket (password-reset.spec.ts).
    await page.setExtraHTTPHeaders({
      "x-forwarded-for": `198.51.100.${String(randomInt(1, 255))}`,
    });
    const watch = await watchCspViolations(page);

    await page.goto("/reset-password");
    await page
      .getByLabel(resetCopy.emailLabel, { exact: true })
      .fill(`e2e-${randomUUID()}@example.com`);
    await page.getByRole("button", { name: resetCopy.requestSubmit }).click();

    await expect(page).toHaveURL(/\/reset-password\?notice=sent$/);
    await expectNoViolations(page, watch);
  });

  test("the claim form submits and moves on with nothing refused", async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders({
      "x-forwarded-for": `198.51.100.${String(randomInt(1, 255))}`,
    });
    const path = unclaimedHandlePath();
    const watch = await watchCspViolations(page);

    await page.goto(path);
    await page
      .getByRole("textbox", { name: claimCopy.claimEmailLabel })
      .fill(`e2e-${randomUUID()}@example.com`);
    await page
      .getByLabel(claimCopy.claimPasswordLabel, { exact: true })
      .fill(`e2e-${randomUUID()}`);
    await page.getByRole("button", { name: claimCopy.claimSubmit }).click();

    // The one success URL for a Claim (`components/claim-action.ts`).
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toMatch(/^\/claim\/held\//);
    await expectNoViolations(page, watch);
  });
});

/**
 * A Handle nobody has claimed, drawn at random as `accessibility.spec.ts`
 * draws one, so a claim here collides with nothing another spec relies on.
 * The Handles `handle-url.spec.ts` needs unclaimed are drawn again.
 */
function unclaimedHandlePath(): string {
  const keep = unclaimedSeveralHandleKeys();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const segment = Array.from(
      { length: HANDLE_LENGTH },
      () => curatedEmojiSet[randomInt(curatedEmojiSet.length)]?.emoji ?? "",
    ).join("");
    const result = canonicalise(segment);
    if (result.ok && !isReservedHandle(result.key) && !keep.has(result.key)) {
      return `/${result.encoded}`;
    }
  }
  throw new Error("Could not draw an unreserved Handle.");
}
