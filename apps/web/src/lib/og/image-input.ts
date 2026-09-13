import type { ProfileState } from "@template/core";
import type { AvailabilityState } from "../../components/availability-state";
import { boundedDisplayName, isDrawableInImage } from "./display-name";
import { glyphDataUriOf } from "./glyphs";

/** What the Open Graph image reads off a Handle: its three emoji. */
export interface ImageHandle {
  readonly key: string;
  readonly emoji: readonly { readonly emoji: string }[];
}

/**
 * Everything an Open Graph image is drawn from, and nothing else
 * ([#161](https://github.com/joshstothard/3moji/issues/161)).
 *
 * **Two shapes, and one of them carries nothing at all.** `generic` is one
 * value for every Handle that is not claimed — available, held, reserved,
 * unknown, not a Handle — so the image, and the response around it, cannot
 * differ between them. An image route that drew a held Handle differently from
 * a free one would be a way to probe holds that the page itself never offers.
 *
 * `handle` carries the three glyphs and at most a bounded display name. There
 * is no field for a bio, a Link, a holder or an expiry, so none can be drawn.
 */
export type OgImageInput =
  | { readonly kind: "generic" }
  | {
      readonly kind: "handle";
      readonly glyphs: readonly string[];
      readonly displayName: string | undefined;
    };

/** The image for every Handle that is not somebody's, and for everything else. */
export const GENERIC_IMAGE: OgImageInput = Object.freeze({ kind: "generic" });

/**
 * The image for `handle`, given what the availability and Profile reads said.
 *
 * **Claimed is decided here again, and the Profile does not decide it.** The
 * reads already refuse to fetch a Profile for anything but a claimed Handle
 * (`lib/profile.ts`); this is the independent layer at the last place a name
 * could be drawn, and `image-input.test.ts` hands it a full Profile at every
 * other state to prove it.
 *
 * - A claimed Handle whose Profile read **failed** (`none`) gets the generic
 *   image, as its page gets the honest "taken" line rather than a Profile.
 * - An emoji with **no bundled glyph** gets the generic image: two emoji and a
 *   gap would misstate the Handle. `glyphs.test.ts` keeps this unreachable for
 *   the released set.
 * - A display name the bundled font **cannot draw** is left out and the emoji
 *   are still drawn — see `isDrawableInImage` for why it is not drawn anyway.
 */
export function ogImageInputOf(
  handle: ImageHandle,
  state: AvailabilityState,
  profile: ProfileState,
): OgImageInput {
  if (state !== "claimed" || profile.state === "none") return GENERIC_IMAGE;

  const glyphs: string[] = [];
  for (const entry of handle.emoji) {
    const glyph = glyphDataUriOf(entry.emoji);
    if (glyph === undefined) return GENERIC_IMAGE;
    glyphs.push(glyph);
  }

  const name =
    profile.state === "profile"
      ? boundedDisplayName(profile.profile.displayName)
      : undefined;

  return {
    kind: "handle",
    glyphs,
    displayName:
      name !== undefined && isDrawableInImage(name) ? name : undefined,
  };
}
