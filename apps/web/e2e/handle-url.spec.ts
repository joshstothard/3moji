import { expect, test } from "@playwright/test";
import en from "../../../packages/shared/messages/en.json";

/**
 * End-to-end proof of the Phase 2 outcome: a URL containing emoji resolves to
 * exactly one canonical Handle.
 *
 * This is the only place the real `canonicalise` meets the real route — the
 * page's unit test mocks `@template/core`, because that package pulls in
 * ESM-only dependencies the web Jest suite cannot `require`. So the assertions
 * below are about bytes on the wire, not about component output.
 */

/** 🧊 U+1F9CA, percent-encoded. Food & Drink, released at launch. */
const ICE = "%F0%9F%A7%8A";
/** 🍕 U+1F355 — the platform-owned demo Handle in `RESERVED_HANDLE_ENTRIES`. */
const PIZZA = "%F0%9F%8D%95";
/** 🔪 U+1F52A — a blocked emoji, and in a released category so it is reachable. */
const KNIFE = "%F0%9F%94%AA";

/** U+FE0F, the emoji presentation selector. */
const VS16 = "%EF%B8%8F";

const CANONICAL = `/${ICE}${ICE}${ICE}`;
/**
 * The same Handle, spelled with a trailing variation selector. This is the
 * spelling that discriminates: Next.js upper-cases percent-escapes before the
 * page sees them, so a lower-case-hex request arrives already canonical, while
 * a variation selector survives into the segment untouched (confirmed by curl
 * against this Next.js version; see docs/reports/2026-09-11-emoji-urls.md).
 */
const NON_CANONICAL = `${CANONICAL}${VS16}`;

const copy = en.HandlePage;
/**
 * The builder's namespace. An unclaimed Handle renders the builder
 * ([#105](https://github.com/joshstothard/3moji/issues/105)), so "This Handle
 * is available." is now the builder's wording rather than this page's — which
 * is why the assertions below reach for it there.
 */
const builderCopy = en.HandleBuilder;
/** Every honest answer the route can give about a Handle that resolves. */
const EVERY_ANSWER: readonly string[] = Object.values(copy);

test("a non-canonical spelling redirects permanently to the canonical path", async ({
  request,
}) => {
  const response = await request.get(NON_CANONICAL, { maxRedirects: 0 });

  expect(response.status()).toBe(308);
  expect(response.headers().location).toBe(CANONICAL);
});

test("the Location header is percent-encoded, never raw emoji", async ({
  request,
}) => {
  const response = await request.get(NON_CANONICAL, { maxRedirects: 0 });
  const location = response.headers().location;

  // A raw emoji in a Location header fails Node's header validation with
  // ERR_INVALID_CHAR and serves a 500 instead of a redirect, so the bytes
  // matter: ASCII escapes only.
  expect(location).toMatch(/^\/(?:%[0-9A-F]{2})+$/);
});

test("a browser walking a non-canonical URL lands on the canonical Handle", async ({
  page,
}) => {
  await page.goto(NON_CANONICAL);

  // The browser displays the path decoded; compare decoded so the assertion
  // does not depend on which form Chromium chooses to show.
  const { pathname } = new URL(page.url());
  expect(decodeURIComponent(pathname)).toBe("/\u{1F9CA}\u{1F9CA}\u{1F9CA}");
  await expect(
    page.getByRole("heading", { level: 1, name: "three ice cubes" }),
  ).toBeVisible();

  // Which answer 🧊🧊🧊 gets depends on the environment, and deliberately so:
  // `lib/services.ts` needs five variables and this job sets one, so the read
  // degrades to "we could not check" here and would say "available" against a
  // configured database. What is environment-independent — and what this
  // asserts — is that the route renders one of the five honest answers rather
  // than assuming availability. The branch table itself is unit-tested in
  // `src/app/[handle]/page.test.tsx`.
  const body = await page.textContent("body");
  expect(EVERY_ANSWER.some((answer) => body?.includes(answer))).toBe(true);
});

test("a platform-reserved Handle resolves, and is never called available", async ({
  request,
}) => {
  // Issue #68, on the wire. 🍕🍕🍕 is the demo Profile in the Reserved Handle
  // list: a real, well-formed Handle that nobody may own, so 404 would be a
  // lie of the opposite kind. `claimableHandle` is pure, which is why this
  // answer holds in a job with no database as well as against a real one.
  const response = await request.get(`/${PIZZA}${PIZZA}${PIZZA}`, {
    maxRedirects: 0,
  });

  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain(copy.stateNotClaimable);
  expect(body).not.toContain(builderCopy.stateAvailable);
  // And it is never offered for the taking. A Reserved Handle can never be
  // claimed, so rendering the builder here would be #68 in a new form.
  expect(body).not.toContain(builderCopy.builderHeading);
  expect(body).not.toContain(copy.unclaimed);
});

test("a Handle carrying a blocked emoji resolves to the same answer, with no reason given", async ({
  request,
}) => {
  const response = await request.get(`/${KNIFE}${KNIFE}${KNIFE}`, {
    maxRedirects: 0,
  });

  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain(copy.stateNotClaimable);
  expect(body).not.toContain(builderCopy.stateAvailable);
  expect(body).not.toContain(builderCopy.builderHeading);
  expect(body).not.toContain(copy.unclaimed);
  // Naming the block would be a hint to go looking for the list, so the two
  // reserved kinds are one message. The reason never leaves `packages/core`.
  expect(body.toLowerCase()).not.toContain("threat");
  expect(body.toLowerCase()).not.toContain("blocked");
});

test("the canonical URL is served directly, with no redirect", async ({
  request,
}) => {
  const response = await request.get(CANONICAL, { maxRedirects: 0 });

  expect(response.status()).toBe(200);
});

test("a segment that cannot be canonicalised is a 404", async ({ request }) => {
  // Three ASCII code points: it clears the length gate and fails Emoji Set
  // membership, so the page's own notFound() is what answers. A malformed
  // escape such as /%F0%9F is deliberately not tested here — Next.js rejects
  // it before the page runs (400 in dev, 500 in production), so it would prove
  // nothing about this route.
  const response = await request.get("/abc", { maxRedirects: 0 });

  expect(response.status()).toBe(404);
});

test("a Handle of the wrong length is a 404", async ({ request }) => {
  const response = await request.get(`/${ICE}${ICE}`, { maxRedirects: 0 });

  expect(response.status()).toBe(404);
});

test("the root-level dynamic route does not swallow the auth API", async ({
  request,
}) => {
  // A catch-all here — `[...handle]` instead of `[handle]` — would match
  // `/api/auth/ok`, fail canonicalisation and answer 404. That 404 is the
  // failure this asserts against.
  //
  // The status is deliberately not pinned: CI's E2E job sets DATABASE_URL but
  // not BETTER_AUTH_SECRET or the Resend variables, so `lib/services.ts` throws
  // and Better Auth's route answers 500. A 500 from the auth handler and a 200
  // from a fully configured one are both proof that the auth route, not this
  // one, received the request.
  const response = await request.get("/api/auth/ok", { maxRedirects: 0 });

  expect(response.status()).not.toBe(404);
  expect(await response.text()).not.toContain("This Handle is available");
});

test("the root-level dynamic route does not swallow the home page", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "3moji" }),
  ).toBeVisible();
});

/**
 * The word alias
 * ([ADR-0008](../../../docs/adr/0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md)).
 *
 * This is the only place the real resolver meets the real route, and the only
 * place a **dotted path segment** is proved to reach the route at all rather
 * than being taken for a static file. That proof holds for `next dev` here;
 * whether Vercel's CDN agrees is
 * [#32](https://github.com/joshstothard/3moji/issues/32), and unverified.
 */
const CANONICAL_ALIAS = "/ice-cube.ice-cube.ice-cube";

test("a word alias resolves in place, with no redirect at all", async ({
  request,
}) => {
  // The load-bearing assertion of ADR-0008, made on the wire rather than
  // argued from the code: a 308 to the emoji path would replace the shared
  // ASCII link in the address bar with 45 characters of percent-escapes, which
  // is the entire defect the alias exists to avoid. `maxRedirects: 0` is what
  // makes the absence of a `Location` header observable.
  const response = await request.get(CANONICAL_ALIAS, { maxRedirects: 0 });

  expect(response.status()).toBe(200);
  expect(response.headers().location).toBeUndefined();

  const body = await response.text();
  expect(EVERY_ANSWER.some((answer) => body.includes(answer))).toBe(true);
});

test("an alias page declares the emoji path as canonical", async ({
  request,
}) => {
  // An alias is ambiguous by construction and can never be canonical, so the
  // one indexable URL per Profile is the emoji one.
  const response = await request.get(CANONICAL_ALIAS, { maxRedirects: 0 });
  const body = await response.text();

  expect(body).toContain(`rel="canonical"`);
  expect(body).toContain(`${ICE}${ICE}${ICE}`);
});

test("an alias naming more than one Handle says so and lists nothing", async ({
  request,
}) => {
  // `apple` is a synonym of both 🍎 and 🍏, so this names eight Handles. The
  // listing is #109; until it exists the page says so and shows none of them.
  const response = await request.get("/apple.apple.apple", {
    maxRedirects: 0,
  });

  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain(copy.aliasSeveral);
  expect(body).not.toContain(builderCopy.builderHeading);
  expect(body).not.toContain(`rel="canonical"`);
});

/**
 * Written as a loop rather than with `test.each`, which Playwright's runner
 * does not have.
 *
 * The last case is the measured reason the separator is a dot: a hyphen-joined
 * form has no unambiguous reading, so it is not a grammar at all and 404s like
 * any other word.
 */
const NOT_AN_ALIAS: readonly (readonly [string, string])[] = [
  ["a word we do not know", "/nonsense.nonsense.nonsense"],
  ["the wrong number of terms", "/ice-cube.ice-cube"],
  ["a hyphen where the separator belongs", "/ice-cube-ice-cube-ice-cube"],
];

for (const [name, path] of NOT_AN_ALIAS) {
  test(`404s an ASCII segment with ${name}`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });

    expect(response.status()).toBe(404);
  });
}
