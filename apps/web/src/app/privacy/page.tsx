import type { Metadata } from "next";

import en from "../../../../../packages/shared/messages/en.json";
import { LegalDocument } from "../../components/legal-document";
import { reportContactAddress } from "../../lib/report-link";

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

/**
 * Rendered per request, so the contact address is read from
 * `REPORT_CONTACT_EMAIL` at runtime and a changed value needs no rebuild
 * ([#242](https://github.com/joshstothard/3moji/issues/242)). The root layout
 * already forces this for its CSP nonce (#205); saying it here keeps the page
 * right if that ever changes. It reads configuration only, never the request.
 */
export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  return (
    <LegalDocument
      contact={reportContactAddress()}
      heading={copy.heading}
      intro={copy.intro}
      related={{ href: "/terms", label: copy.relatedLink }}
      sections={copy.sections}
    />
  );
}
