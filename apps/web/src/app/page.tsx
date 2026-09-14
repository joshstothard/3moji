import type { Metadata } from "next";
import { HandleBuilder } from "../components/handle-builder";
import { HandleLookup } from "../components/handle-lookup";
import { LinkedSentence } from "../components/linked-sentence";
import { checkAvailability } from "../components/availability-action";
import { claimFormAction } from "../components/claim-action";
import { genericMetadataOf } from "../lib/og/metadata";
import { siteOrigin } from "../lib/share-link";
import en from "../../../../packages/shared/messages/en.json";

const copy = en.Home;

/**
 * The home page's link preview
 * ([#204](https://github.com/joshstothard/3moji/issues/204)): the site's name,
 * its tagline and the one generic image at `/og-image`, the same card every
 * page that is not a claimed Profile gets.
 *
 * `metadataBase` is set here, not in the root layout, because layout metadata
 * is inherited by every page, Profiles included. With no configured origin it
 * is omitted, like every absolute URL in the card (`lib/og/metadata.ts`), so
 * Next.js never resolves one against a guessed host. Read when the page renders,
 * not at module scope; since #205 every page renders per request, so that is at
 * runtime.
 */
export function generateMetadata(): Metadata {
  const origin = siteOrigin();
  return {
    ...(origin === undefined ? {} : { metadataBase: new URL(origin) }),
    ...genericMetadataOf(origin),
  };
}

/**
 * The home page: the surface the product is judged on.
 *
 * A server component that holds no state and fetches nothing. Its whole job is
 * composition — it hands the builder the one collaborator that has to run on
 * the server, the availability read, and lets the builder own the interaction.
 * Nothing here touches `lib/services.ts`, so the page still renders on a clone
 * with no environment at all; the read is attempted only once a visitor has
 * filled three slots.
 *
 * **The composition is the brand's** (#251): the hero beside the builder's card
 * on a wide screen, stacked on a phone, and the picker across the full width
 * below. `HandleBuilder` renders its card, the claim form and the picker as
 * siblings, so they are this grid's own children: the first two take a column
 * each, and everything after them spans both. That is done with a child
 * selector here rather than by reaching into the builder, whose markup other
 * issues own. The lookup stays in the hero until the header search replaces it
 * ([#254](https://github.com/joshstothard/3moji/issues/254)).
 *
 * **No radial glow.** The design has soft glows behind the hero. Drawn as an
 * `aria-hidden`, `pointer-events: none` element behind the builder's card, axe
 * still reported the card's heading, spoken line and URL as `color-contrast`
 * incomplete ("overlapped by another element"), and `accessibility.spec.ts`
 * refuses an incomplete result. Removing the element cleared it, so the page
 * goes without.
 */
export default function Home() {
  return (
    <main>
      <div className="mx-auto grid max-w-7xl gap-10 px-4 pt-6 pb-16 sm:px-8 sm:pt-12 lg:grid-cols-2 lg:items-center lg:gap-x-16 lg:gap-y-12 lg:px-12 lg:pt-16 [&>*]:mt-0 lg:[&>*:nth-child(n+3)]:col-span-2">
        <div className="flex flex-col gap-5 *:mt-0 sm:gap-7">
          <p className="hidden min-h-[34px] items-center gap-2 self-start rounded-full border border-line bg-card px-3.5 text-sm text-body sm:inline-flex">
            <span aria-hidden="true" className="text-base">
              {copy.eyebrowEmoji}
            </span>
            {copy.eyebrow}
          </p>
          <h1 className="font-display text-[52px] leading-[0.94] font-extrabold tracking-[-0.05em] text-balance text-ink sm:text-7xl lg:text-[88px] lg:leading-[0.92] xl:text-[96px]">
            <LinkedSentence
              links={{
                accent: (
                  <span className="text-violet">{copy.headingAccent}</span>
                ),
              }}
              text={copy.heading}
            />
          </h1>
          <p className="max-w-[520px] text-[17px] leading-normal text-pretty text-body sm:text-[21px]">
            {copy.tagline}
          </p>
          <HandleLookup />
        </div>

        <HandleBuilder
          checkAvailability={checkAvailability}
          claim={claimFormAction}
        />
      </div>
    </main>
  );
}
