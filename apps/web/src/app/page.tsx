import type { Metadata } from "next";
import { HandleBuilder } from "../components/handle-builder";
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
 * **The connected layout** ([#263](https://github.com/joshstothard/3moji/issues/263)):
 * a centred hero, then the builder's composer, which holds the slots, the
 * picker and the claim form in one card from `md` and runs edge to edge on a
 * phone. **Finding a Handle is the header search's**
 * ([#254](https://github.com/joshstothard/3moji/issues/254)), on every page,
 * so this page carries no lookup of its own; `/find` is the no-JavaScript
 * fallback.
 *
 * `overflow-x-clip` lets the phone's Handle bar and tabs run the full width of
 * the screen without the page scrolling sideways. It is `clip`, not `hidden`,
 * because `hidden` makes a scroll container and would stop them sticking.
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
    <main className="overflow-x-clip">
      <div className="mx-auto max-w-7xl px-4 pt-8 pb-16 sm:px-8 sm:pt-14 lg:px-12 lg:pt-14">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-4 text-center">
          <h1 className="font-display text-5xl leading-[0.94] font-extrabold tracking-[-0.05em] text-balance text-ink sm:text-7xl lg:text-[84px] lg:leading-[0.92]">
            <LinkedSentence
              links={{
                accent: (
                  <span className="text-violet">{copy.headingAccent}</span>
                ),
              }}
              text={copy.heading}
            />
          </h1>
          <p className="max-w-[560px] text-[17px] leading-normal text-pretty text-body sm:text-xl">
            {copy.tagline}
          </p>
        </div>

        <HandleBuilder
          checkAvailability={checkAvailability}
          claim={claimFormAction}
        />
      </div>
    </main>
  );
}
