import type { Metadata } from "next";

import en from "../../../../../packages/shared/messages/en.json";
import { LegalDocument } from "../../components/legal-document";

/**
 * The privacy notice ([#196](https://github.com/joshstothard/3moji/issues/196)).
 *
 * **A draft for the owner to review, not legal advice.** What it says is
 * stored, and for how long, is taken from `docs/architecture/data-model.md`,
 * `auth.md` and the schema in `packages/core/src/db/` — so a change to what
 * the service stores, or to when it deletes it, has to change this copy too.
 */
const copy = en.Legal.Privacy;

export const metadata: Metadata = { title: copy.metaTitle };

export default function PrivacyPage() {
  return (
    <LegalDocument
      heading={copy.heading}
      intro={copy.intro}
      related={{ href: "/terms", label: copy.relatedLink }}
      sections={copy.sections}
    />
  );
}
