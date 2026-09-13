import { expect, test, type APIRequestContext } from "@playwright/test";
import { canonicalAliasOf } from "@template/core";
import { seedClaimedHandle } from "./support/seed";

/**
 * A Profile's Open Graph metadata and image, on the wire
 * ([#161](https://github.com/joshstothard/3moji/issues/161)).
 *
 * The unit suites prove which metadata and which image input each state gets,
 * with `next/og` faked. This is where the real renderer draws a real PNG for a
 * Handle claimed through the domain, and where the URLs the page emits are
 * followed rather than assumed.
 */

/** 🍕 U+1F355 ×3 — the platform-owned Handle in `RESERVED_HANDLE_ENTRIES`. */
const RESERVED = "/%F0%9F%8D%95%F0%9F%8D%95%F0%9F%8D%95";

/** The origin every absolute metadata URL is built from: `BETTER_AUTH_URL`. */
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

function canonicalsOf(html: string): string[] {
  return tagsOf(html)
    .filter((tag) => tag.rel === "canonical")
    .map((tag) => tag.href ?? "");
}

/** Width and height from a PNG's IHDR chunk, which is always first. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  expect(bytes.toString("latin1", 12, 16)).toBe("IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function pageHtml(
  request: APIRequestContext,
  path: string,
): Promise<string> {
  const response = await request.get(path, { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  return response.text();
}

test("a claimed Profile's page emits its card, and its image is a 1200×630 PNG", async ({
  request,
}) => {
  const seeded = await seedClaimedHandle({
    profile: {
      displayName: "Open Graph Owner",
      bio: "This bio must not reach the card.",
      links: [{ title: "Card link", url: "https://example.com/og-link" }],
    },
  });
  const origin = configuredOrigin();
  const html = await pageHtml(request, seeded.path);

  expect(metaContent(html, "og:title")).toBe(
    `Open Graph Owner · ${seeded.key}`,
  );
  expect(metaContent(html, "og:description")).toBeTruthy();
  expect(metaContent(html, "twitter:card")).toBe("summary_large_image");
  expect(metaContent(html, "og:url")).toBe(`${origin}${seeded.path}`);
  expect(canonicalsOf(html)).toEqual([`${origin}${seeded.path}`]);

  const image = metaContent(html, "og:image");
  expect(image).toBe(`${origin}${seeded.path}/og-image`);
  expect(metaContent(html, "og:image:width")).toBe("1200");
  expect(metaContent(html, "og:image:height")).toBe("630");
  expect(metaContent(html, "twitter:image")).toBe(image);
  // The card carries the display name and nothing else the owner typed.
  const card = tagsOf(html)
    .filter(
      (tag) =>
        tag.property?.startsWith("og:") ?? tag.name?.startsWith("twitter:"),
    )
    .map((tag) => tag.content ?? "")
    .join("\n");
  expect(card).not.toContain("This bio must not reach the card.");
  expect(card).not.toContain("example.com/og-link");

  // Followed, not assumed: the URL the page emitted is the image.
  const response = await request.get(new URL(image ?? "").pathname, {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
  expect(response.headers()["cache-control"]).toBe(
    "public, max-age=300, s-maxage=300",
  );
  expect(pngSize(await response.body())).toEqual({ width: 1200, height: 630 });
});

test("the word alias of a Profile declares the same emoji path as og:url and canonical", async ({
  request,
}) => {
  const seeded = await seedClaimedHandle();
  const alias = canonicalAliasOf(seeded.emoji.map((entry) => entry.emoji));
  expect(alias).toBeDefined();
  const origin = configuredOrigin();

  const html = await pageHtml(request, `/${alias ?? ""}`);

  expect(metaContent(html, "og:url")).toBe(`${origin}${seeded.path}`);
  expect(canonicalsOf(html)).toEqual([`${origin}${seeded.path}`]);
  expect(metaContent(html, "og:image")).toBe(
    `${origin}${seeded.path}/og-image`,
  );
});

test("a Handle nobody may own gets the generic card and the generic image", async ({
  request,
}) => {
  const origin = configuredOrigin();
  const html = await pageHtml(request, RESERVED);

  expect(metaContent(html, "og:title")).toBe("3moji");
  expect(metaContent(html, "og:image")).toBe(`${origin}/og-image`);
});

test("every image that is not a claimed Profile's is the same bytes with the same headers", async ({
  request,
}) => {
  // The image route must not be a way to probe a Handle's state: a reserved
  // Handle, a segment that is not a Handle at all and the site's own generic
  // image answer identically.
  const seeded = await seedClaimedHandle();
  const paths = ["/og-image", `${RESERVED}/og-image`, "/not.a.handle/og-image"];

  const responses = await Promise.all(
    paths.map((path) => request.get(path, { maxRedirects: 0 })),
  );
  const bodies = await Promise.all(
    responses.map((response) => response.body()),
  );

  for (const response of responses) {
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/png");
    expect(response.headers()["cache-control"]).toBe(
      "public, max-age=300, s-maxage=300",
    );
  }
  const [generic, ...others] = bodies;
  for (const body of others) {
    expect(body.equals(generic ?? Buffer.alloc(0))).toBe(true);
  }
  expect(pngSize(generic ?? Buffer.alloc(0))).toEqual({
    width: 1200,
    height: 630,
  });

  // And a claimed Profile's image is not that image.
  const claimed = await request.get(`${seeded.path}/og-image`);
  expect(claimed.status()).toBe(200);
  expect((await claimed.body()).equals(generic ?? Buffer.alloc(0))).toBe(false);
});
