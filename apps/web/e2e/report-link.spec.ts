import { expect, test } from "@playwright/test";
import en from "../../../packages/shared/messages/en.json";
import { seedClaimedHandle } from "./support/seed";

/**
 * The report link on a real Profile, on the wire
 * ([#197](https://github.com/joshstothard/3moji/issues/197)).
 *
 * The unit suites prove the link is built from `REPORT_CONTACT_EMAIL` and the
 * canonical path, and that the route reads no request headers to render it.
 * This is where a Handle claimed through the domain is fetched from the real
 * app, with the variable passed through Turborepo's strict env mode
 * (`turbo.json`'s `dev.passThroughEnv`) — a step that would otherwise drop it
 * silently and render no link.
 */

const copy = en.HandlePage;

/** The placeholder CI's E2E job sets. Never a real mailbox. */
function configuredAddress(): string {
  const value = process.env.REPORT_CONTACT_EMAIL;
  if (value === undefined || value === "") {
    throw new Error(
      "REPORT_CONTACT_EMAIL is not set; see the e2e job in .github/workflows/ci.yml.",
    );
  }
  return value;
}

/** The `href` of the report link in a document, `&amp;` unescaped. */
function reportHrefIn(html: string): string | undefined {
  const anchor = [...html.matchAll(/<a\b[^>]*>([^<]*)<\/a>/g)].find(
    (match) => match[1] === copy.report,
  );
  const href = anchor?.[0].match(/href="([^"]*)"/)?.[1];
  return href?.replaceAll("&amp;", "&");
}

test("a claimed Profile links to the report mailbox with its canonical path in the subject", async ({
  page,
}) => {
  const seeded = await seedClaimedHandle({
    profile: {
      displayName: "Report Link Owner",
      bio: "Checked for a report link.",
      links: [{ title: "Report spec link", url: "https://example.com/r" }],
    },
  });

  await page.goto(seeded.path);
  const link = page.getByRole("link", { name: copy.report });

  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute(
    "href",
    `mailto:${configuredAddress()}?subject=${encodeURIComponent(
      copy.reportSubject.replace("{path}", seeded.path),
    )}`,
  );
});

test("the report link is the same for a visitor carrying a session cookie as for one without", async ({
  request,
}) => {
  const seeded = await seedClaimedHandle();

  const anonymous = await request.get(seeded.path, { maxRedirects: 0 });
  const withCookie = await request.get(seeded.path, {
    maxRedirects: 0,
    headers: { cookie: "better-auth.session_token=not-a-real-session" },
  });

  expect(anonymous.status()).toBe(200);
  expect(withCookie.status()).toBe(200);
  const href = reportHrefIn(await anonymous.text());
  expect(href).toBeDefined();
  expect(reportHrefIn(await withCookie.text())).toBe(href);
  expect(anonymous.headers().vary ?? "").not.toMatch(/cookie/i);
});
