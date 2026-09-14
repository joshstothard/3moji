import type { Metadata } from "next";

import en from "../../../../../packages/shared/messages/en.json";
import { LegalDocument } from "../../components/legal-document";
import { reportContactAddress } from "../../lib/report-link";

/**
 * The terms of use ([#196](https://github.com/joshstothard/3moji/issues/196)).
 *
 * **A draft for the owner to review, not legal advice.**
 */
const copy = en.Legal.Terms;

export const metadata: Metadata = { title: copy.metaTitle };

/**
 * Rendered per request, so the contact address is read from
 * `REPORT_CONTACT_EMAIL` at runtime and a changed value needs no rebuild
 * ([#242](https://github.com/joshstothard/3moji/issues/242)). It reads
 * configuration only, never the request.
 */
export const dynamic = "force-dynamic";

export default function TermsPage() {
  return (
    <LegalDocument
      contact={reportContactAddress()}
      heading={copy.heading}
      intro={copy.intro}
      related={{ href: "/privacy", label: copy.relatedLink }}
      sections={copy.sections}
    />
  );
}
