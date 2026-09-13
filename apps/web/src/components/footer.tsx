import Link from "next/link";

import { LinkedSentence } from "./linked-sentence";
import { siteReportLink } from "../lib/report-link";
import en from "../../../../packages/shared/messages/en.json";

const copy = en.Footer;

/**
 * Where the emoji glyphs in the Open Graph images come from, and their licence
 * (`docs/architecture/system-overview.md` § Open Graph images;
 * `lib/og/TWEMOJI-LICENSE-GRAPHICS.txt`).
 */
const TWEMOJI_URL = "https://github.com/jdecked/twemoji";
const LICENCE_URL = "https://creativecommons.org/licenses/by/4.0/";

/**
 * The footer's own links. `min-h-6` meets WCAG 2.5.8's 24px target, and the
 * outline is the focus indicator the keyboard-only spec looks for.
 */
const NAV_LINK =
  "inline-flex min-h-6 items-center text-slate-700 underline hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600";

/** Links inside the credit sentence, which WCAG 2.5.8 exempts as inline. */
const INLINE_LINK =
  "underline hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600";

/**
 * The footer on every page
 * ([#198](https://github.com/joshstothard/3moji/issues/198)): the privacy
 * notice, the terms of use, a way to report a page, the Twemoji credit, and the
 * UI version.
 *
 * **A server component that reads configuration and nothing else.** It is
 * rendered by the root layout, so a request header or cookie read here would
 * make every page, the public Profile included, vary by viewer.
 * `REPORT_CONTACT_EMAIL` is not a `NEXT_PUBLIC_` variable, so this must stay on
 * the server: as a client component it would render no report entry at all.
 *
 * **No address, no report entry.** `siteReportLink` refuses an unset or unusable
 * value, as the Profile's own report link does.
 */
export function Footer() {
  const uiVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
  const uiLabel = copy.ui.replace("{version}", uiVersion);
  const reportHref = siteReportLink();

  return (
    <footer className="bg-white border-t border-slate-200">
      <div className="max-w-5xl mx-auto flex flex-col items-center gap-3 px-4 py-6 text-center sm:px-6 lg:px-8">
        <nav aria-label={copy.legalNavLabel}>
          <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
            <li>
              <Link className={NAV_LINK} href="/privacy">
                {copy.privacy}
              </Link>
            </li>
            <li>
              <Link className={NAV_LINK} href="/terms">
                {copy.terms}
              </Link>
            </li>
            {reportHref !== undefined && (
              <li>
                <a className={NAV_LINK} href={reportHref}>
                  {copy.report}
                </a>
              </li>
            )}
          </ul>
        </nav>
        <p className="max-w-prose text-xs leading-5 text-slate-600">
          <LinkedSentence
            links={{
              twemoji: (
                <a className={INLINE_LINK} href={TWEMOJI_URL}>
                  {copy.emojiCreditTwemoji}
                </a>
              ),
              licence: (
                <a className={INLINE_LINK} href={LICENCE_URL} rel="license">
                  {copy.emojiCreditLicence}
                </a>
              ),
            }}
            text={copy.emojiCredit}
          />
        </p>
        <p className="text-xs text-slate-600">{uiLabel}</p>
      </div>
    </footer>
  );
}
