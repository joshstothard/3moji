import { canonicalise } from "@template/core";
import { readAvailability } from "../availability";
import { readProfile } from "../profile";
import {
  GENERIC_IMAGE,
  ogImageInputOf,
  type OgImageInput,
} from "./image-input";

/**
 * What `/[handle]/og-image` draws for the segment it was asked about
 * ([#161](https://github.com/joshstothard/3moji/issues/161)).
 *
 * **Every answer but a claimed Handle's is {@link GENERIC_IMAGE}, and none of
 * them is an error.** A segment that is not a Handle gets the generic image,
 * not a 404: an image route that answered junk differently from a reserved
 * Handle, or a reserved Handle differently from a held one, would tell a
 * prober what the page itself never says.
 *
 * **Any spelling `canonicalise` accepts is the same Handle, and is drawn as
 * one.** There is no 308 and no `isCanonical` gate. CI's E2E run showed why
 * the gate was wrong: a route handler is handed its segment spelled
 * differently from the encoded path the page emitted, so the gate drew the
 * generic image for a claimed Profile. The reads use the canonical `encoded`
 * segment, never the received one, so another spelling reveals nothing the
 * canonical path does not.
 *
 * The reads are the page's own, handed the same percent-encoded segment, so
 * the image and the page cannot be about different Handles — and the Profile
 * is read **only** for a claimed Handle.
 */
export async function ogImageInputForSegment(
  segment: string,
): Promise<OgImageInput> {
  const result = canonicalise(segment);
  if (!result.ok) return GENERIC_IMAGE;

  const state = await readAvailability(result.encoded);
  if (state !== "claimed") return GENERIC_IMAGE;

  const profile = await readProfile(result.encoded, state);
  return ogImageInputOf(result, state, profile);
}
