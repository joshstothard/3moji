import type { Metadata } from "next";
import { HandleBuilder } from "../components/handle-builder";
import { HandleLookup } from "../components/handle-lookup";
import { checkAvailability } from "../components/availability-action";
import { claimFormAction } from "../components/claim-action";
import { genericMetadataOf } from "../lib/og/metadata";
import { siteOrigin } from "../lib/share-link";
import en from "../../../../packages/shared/messages/en.json";

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
 * not at module scope; the home page is static, so that is at build time.
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
 */
export default function Home() {
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-slate-900 mb-3 tracking-tight">
          {en.Home.heading}
        </h1>
        <p className="text-lg text-slate-500">{en.Home.tagline}</p>
      </div>

      <HandleLookup />

      <HandleBuilder
        checkAvailability={checkAvailability}
        claim={claimFormAction}
      />
    </main>
  );
}
