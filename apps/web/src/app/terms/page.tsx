import type { Metadata } from "next";

import en from "../../../../../packages/shared/messages/en.json";
import { LegalDocument } from "../../components/legal-document";

/**
 * The terms of use ([#196](https://github.com/joshstothard/3moji/issues/196)).
 *
 * **A draft for the owner to review, not legal advice.**
 */
const copy = en.Legal.Terms;

export const metadata: Metadata = { title: copy.metaTitle };

export default function TermsPage() {
  return (
    <LegalDocument
      heading={copy.heading}
      intro={copy.intro}
      related={{ href: "/privacy", label: copy.relatedLink }}
      sections={copy.sections}
    />
  );
}
