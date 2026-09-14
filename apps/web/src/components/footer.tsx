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

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet";

/**
 * The footer's own links. `min-h-11` gives each a 44px target, and the outline
 * is the focus indicator the keyboard-only spec looks for. Muted text is
 * 4.75:1 on paper.
 */
const NAV_LINK = `inline-flex min-h-11 items-center text-muted underline-offset-4 hover:text-ink hover:underline ${FOCUS}`;

/**
 * Links inside the credit sentence, which WCAG 2.5.8 exempts as inline. They
 * stay underlined: inside a sentence, colour alone would not set them apart.
 */
const INLINE_LINK = `underline hover:text-ink ${FOCUS}`;

/**
 * The footer on every page
 * ([#198](https://github.com/joshstothard/3moji/issues/198)): the privacy
 * notice, the terms of use, a way to report a page, the Twemoji credit, and the
 * UI version. Since #251 it signs off with the wordmark and the tagline.
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
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-7 text-center sm:px-8 sm:text-left lg:px-12">
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
          <p className="flex flex-wrap items-baseline justify-center gap-x-2.5 text-sm text-muted">
            <span className="font-display text-lg font-extrabold tracking-[-0.03em] text-ink">
              {en.Brand.wordmark}
            </span>
            <span>{copy.tagline}</span>
          </p>
          <nav aria-label={copy.legalNavLabel}>
            <ul className="flex flex-wrap justify-center gap-x-6 text-sm">
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
        </div>
        <p className="text-xs leading-5 text-muted">
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
        <p className="text-xs text-muted">{uiLabel}</p>
      </div>
    </footer>
  );
}
