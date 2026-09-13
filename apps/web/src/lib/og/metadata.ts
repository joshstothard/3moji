import type { Metadata } from "next";
import type { ProfileState } from "@template/core";
import { spokenHandle } from "@template/core/browser";
import type { AvailabilityState } from "../../components/availability-state";
import { boundedDisplayName } from "./display-name";
import en from "../../../../../packages/shared/messages/en.json";

const copy = en.OpenGraph;

/** The Open Graph image size: the 1.91:1 card every major unfurler crops to. */
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

/** The one generic image, served by `app/og-image/route.ts`. */
export const GENERIC_IMAGE_PATH = "/og-image";

/** The last segment of a Handle's own image, `app/[handle]/og-image/route.ts`. */
export const HANDLE_IMAGE_SEGMENT = "og-image";

/** What the metadata reads off a Handle: its key, its path and its emoji. */
export interface MetadataHandle {
  readonly key: string;
  readonly encoded: string;
  readonly emoji: readonly { readonly emoji: string }[];
}

/**
 * Fills `{placeholders}` in one pass, with a **function** replacer: a string
 * replacer would read `$&` or `$'` inside an owner's display name as a
 * replacement pattern, and a second pass would expand a `{handle}` typed into
 * one.
 */
function fill(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return template.replace(
    /\{(\w+)\}/g,
    (placeholder: string, name: string) => values[name] ?? placeholder,
  );
}

interface Card {
  readonly origin: string | undefined;
  readonly canonicalPath: string | undefined;
  readonly title: string;
  readonly description: string;
  readonly imagePath: string;
  readonly imageAlt: string;
}

/**
 * The Open Graph and Twitter card for a page.
 *
 * **Every URL here is absolute or absent.** An unfurler fetches `og:image` and
 * `og:url` from somewhere else entirely, so a relative one is useless, and
 * Next.js would otherwise resolve it against a guessed `localhost` origin. The
 * origin is `siteOrigin()` — `BETTER_AUTH_URL` — for the reason the share link
 * uses it (`lib/share-link.ts`); when it is not configured, `og:url` and the
 * images are left out and `rel="canonical"` stays the relative path it always
 * was, which is still correct for the host the page was served from.
 */
function cardOf(card: Card): Metadata {
  const url =
    card.origin === undefined || card.canonicalPath === undefined
      ? undefined
      : `${card.origin}${card.canonicalPath}`;
  const image =
    card.origin === undefined ? undefined : `${card.origin}${card.imagePath}`;

  const metadata: Metadata = {
    openGraph: {
      type: "website",
      siteName: copy.siteName,
      title: card.title,
      description: card.description,
      ...(url === undefined ? {} : { url }),
      ...(image === undefined
        ? {}
        : {
            images: [
              {
                url: image,
                width: OG_IMAGE_WIDTH,
                height: OG_IMAGE_HEIGHT,
                alt: card.imageAlt,
              },
            ],
          }),
    },
    twitter: {
      card: "summary_large_image",
      title: card.title,
      description: card.description,
      ...(image === undefined ? {} : { images: [image] }),
    },
  };

  if (card.canonicalPath !== undefined) {
    metadata.alternates = { canonical: url ?? card.canonicalPath };
  }
  return metadata;
}

/**
 * The metadata of every page that is not a claimed Handle's
 * ([#161](https://github.com/joshstothard/3moji/issues/161)): the site's name,
 * its tagline and the one generic image.
 *
 * **It is one value for every such page**, so it says nothing about why the
 * page is not a Profile — not whether a Handle is free, held or reserved, and
 * never who holds it or until when (ADR-0004).
 *
 * @param canonicalPath The page's percent-encoded emoji path, when the page
 * shows exactly one Handle. Omitted for a listing, for an alias naming several
 * Handles and for anything that 404s or redirects: none of those has one
 * canonical emoji path to point at (ADR-0008 decision 5).
 */
export function genericMetadataOf(
  origin: string | undefined,
  canonicalPath?: string,
): Metadata {
  return cardOf({
    origin,
    canonicalPath,
    title: copy.genericTitle,
    description: copy.genericDescription,
    imagePath: GENERIC_IMAGE_PATH,
    imageAlt: copy.genericImageAlt,
  });
}

/**
 * The metadata of a page showing one Handle, whichever address reached it.
 *
 * **The canonical URL and `og:url` are the emoji path**, percent-encoded, for
 * both grammars: an alias is ambiguous by construction and so can never be
 * canonical (ADR-0008 decision 5). The image is the emoji path's too, so both
 * addresses of one Profile unfurl as one card.
 *
 * **Only a claimed Handle gets a card of its own**, and only when there is
 * something to show — a Profile, or an unedited Handle. Every other state,
 * including a claimed Handle whose Profile read failed, is exactly
 * {@link genericMetadataOf} with the canonical path; `metadata.test.ts` forces
 * a full Profile at each of them.
 *
 * The display name is the only owner-typed text used, bounded and cleaned by
 * `boundedDisplayName`; React escapes it into the `<meta>` attribute. The bio
 * and Links are never used.
 */
export function handleMetadataOf(input: {
  readonly origin: string | undefined;
  readonly handle: MetadataHandle;
  readonly state: AvailabilityState;
  readonly profile: ProfileState;
}): Metadata {
  const { origin, handle, state, profile } = input;
  const canonicalPath = `/${handle.encoded}`;

  if (state !== "claimed" || profile.state === "none") {
    return genericMetadataOf(origin, canonicalPath);
  }

  const spoken =
    spokenHandle(handle.emoji.map((entry) => entry.emoji)) ?? handle.key;
  const name =
    profile.state === "profile"
      ? boundedDisplayName(profile.profile.displayName)
      : undefined;

  return cardOf({
    origin,
    canonicalPath,
    title:
      name === undefined
        ? fill(copy.handleTitle, { handle: handle.key })
        : fill(copy.profileTitle, { name, handle: handle.key }),
    description: fill(copy.handleDescription, { spoken }),
    imagePath: `/${handle.encoded}/${HANDLE_IMAGE_SEGMENT}`,
    imageAlt:
      name === undefined
        ? fill(copy.handleImageAlt, { spoken })
        : fill(copy.profileImageAlt, { spoken, name }),
  });
}
