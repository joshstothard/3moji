import { expect, test } from "@playwright/test";
import { canonicalAliasOf } from "@template/core";
import { seedClaimedHandle } from "./support/seed";

/**
 * The site's own metadata files and the home page's card, on the wire
 * ([#204](https://github.com/joshstothard/3moji/issues/204)).
 *
 * The unit suites prove what `robots.ts`, `sitemap.ts` and the home page's
 * `generateMetadata` return. This is where Next.js serialises them, and where
 * the favicon the file convention puts in the head is followed rather than
 * assumed.
 */

/** The origin every absolute URL is built from: `BETTER_AUTH_URL`. */
function configuredOrigin(): string {
  const value = process.env.BETTER_AUTH_URL;
  if (value === undefined || value === "") {
    throw new Error(
      "BETTER_AUTH_URL is not set; see the e2e job in .github/workflows/ci.yml.",
    );
  }
  return new URL(value).origin;
}

/** Every attribute of every `<meta>` and `<link>` tag in a document. */
function tagsOf(html: string): Record<string, string>[] {
  return [...html.matchAll(/<(?:meta|link)\b[^>]*>/g)].map((tag) =>
    Object.fromEntries(
      [...tag[0].matchAll(/([\w:-]+)="([^"]*)"/g)].map((attribute) => [
        attribute[1] ?? "",
        (attribute[2] ?? "").replaceAll("&amp;", "&"),
      ]),
    ),
  );
}

function metaContent(html: string, name: string): string | undefined {
  return tagsOf(html).find((tag) => tag.property === name || tag.name === name)
    ?.content;
}

test("/robots.txt lets crawlers in and names the sitemap on the configured origin", async ({
  request,
}) => {
  const response = await request.get("/robots.txt", { maxRedirects: 0 });

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/plain");
  const body = await response.text();
  expect(body).toContain("User-Agent: *");
  expect(body).toContain(`Sitemap: ${configuredOrigin()}/sitemap.xml`);
});

test("/sitemap.xml lists the static pages and never a claimed Handle", async ({
  request,
}) => {
  const seeded = await seedClaimedHandle();
  const alias = canonicalAliasOf(seeded.emoji.map((entry) => entry.emoji));
  const origin = configuredOrigin();

  const response = await request.get("/sitemap.xml", { maxRedirects: 0 });

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("xml");
  const body = await response.text();
  const locations = [...body.matchAll(/<loc>([^<]*)<\/loc>/g)].map(
    (match) => match[1],
  );
  expect(locations).toEqual([
    `${origin}/`,
    `${origin}/privacy`,
    `${origin}/terms`,
  ]);
  expect(body).not.toContain(seeded.path);
  expect(body).not.toContain(alias ?? seeded.path);
});

test("the home page references a favicon that is served, and unfurls with the generic card", async ({
  request,
}) => {
  const origin = configuredOrigin();
  const response = await request.get("/", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  const html = await response.text();

  const icon = tagsOf(html).find((tag) => tag.rel === "icon");
  expect(icon?.href).toBeTruthy();
  // Followed, not assumed: Next.js may add a query string to the href.
  const served = await request.get(icon?.href ?? "", { maxRedirects: 0 });
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toContain("image/svg+xml");

  expect(metaContent(html, "og:title")).toBe("3moji");
  expect(metaContent(html, "og:image")).toBe(`${origin}/og-image`);
  expect(metaContent(html, "twitter:card")).toBe("summary_large_image");
  expect(metaContent(html, "twitter:image")).toBe(`${origin}/og-image`);
});

test("a claimed Profile keeps its own card, with nothing of the home page's alongside it", async ({
  request,
}) => {
  const seeded = await seedClaimedHandle({
    profile: { displayName: "Site Metadata Owner", bio: "", links: [] },
  });
  const origin = configuredOrigin();

  const response = await request.get(seeded.path, { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  const tags = tagsOf(await response.text());

  const values = (name: string) =>
    tags
      .filter((tag) => tag.property === name || tag.name === name)
      .map((tag) => tag.content);
  expect(values("og:title")).toEqual([`Site Metadata Owner · ${seeded.key}`]);
  expect(values("og:image")).toEqual([`${origin}${seeded.path}/og-image`]);
  expect(values("twitter:image")).toEqual([`${origin}${seeded.path}/og-image`]);
  expect(values("og:url")).toEqual([`${origin}${seeded.path}`]);
});
