import Link from "next/link";

import en from "../../../../packages/shared/messages/en.json";
import { AccountMenu } from "./account-menu";
import { HeaderSearch } from "./header-search";
import { LogoMark } from "./logo-mark";
import { signOutFormAction } from "./sign-out-action";

const copy = en.AccountMenu;
const brand = en.Brand;
const lookupCopy = en.HandleLookup;

/** The focus ring every control in the shell shares. */
const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet";

/**
 * The shell's top bar, on every page.
 *
 * **It never reads the session, and must not** (#193). It wraps every page,
 * the public Profile included, so anything here that depended on who was
 * looking would make every page's HTML differ by visitor. The signed-in
 * indicator is `AccountMenu`, a client island that asks `GET /api/viewer`
 * after the page has arrived; `apps/web/eslint.config.mjs` refuses a session
 * import in this file.
 *
 * Without JavaScript the island never runs, so `<noscript>` offers the
 * sign-in link instead: the same markup for every visitor, and the sign-in
 * form itself works without JavaScript.
 *
 * **It offers the sign-out form beside it** (#194), for the same reason and on
 * the same terms: a page without JavaScript cannot learn who is signed in
 * without reading the session, so both are shown to everybody. The form is
 * the identical markup for every visitor and reads nothing at render; posted
 * by somebody already signed out, it lands on `/` and changes nothing.
 *
 * **The brand** (#251): the logo mark and wordmark, then "Claim a Handle", a
 * link to the builder on the home page, the same for everybody. On a phone the
 * pill gives way, since the builder is the first thing on the home page.
 *
 * **The header search sits between them**
 * ([#254](https://github.com/joshstothard/3moji/issues/254), ADR-0012):
 * `HeaderSearch`, a client island that asks `GET /api/search` after the page
 * has arrived, so it reads nothing here either. From `md` it is a `GET` form to
 * `/find`, which works without JavaScript; on a phone it opens from a button
 * that needs JavaScript, so `<noscript>` links to `/find` instead.
 */
export function Navbar() {
  return (
    <nav className="sticky top-0 z-10 bg-paper">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:h-20 sm:px-8 lg:px-12">
        <Link
          href="/"
          className={`inline-flex min-h-11 items-center gap-2.5 rounded-full font-display text-[22px] font-extrabold tracking-[-0.04em] text-ink sm:text-[26px] ${FOCUS}`}
        >
          <LogoMark className="h-[23px] w-9 sm:h-7 sm:w-11" />
          {brand.wordmark}
        </Link>
        <HeaderSearch />
        <noscript>
          <Link
            href="/find"
            className={`inline-flex min-h-11 items-center rounded-full px-4 text-[15px] font-medium text-ink underline underline-offset-4 hover:text-violet-hover md:hidden ${FOCUS}`}
          >
            {lookupCopy.heading}
          </Link>
        </noscript>
        <div className="flex items-center gap-2">
          <AccountMenu />
          <noscript>
            <Link
              href="/sign-in"
              className={`inline-flex min-h-11 items-center rounded-full px-4 text-[15px] font-medium text-ink underline underline-offset-4 hover:text-violet-hover ${FOCUS}`}
            >
              {copy.signIn}
            </Link>
            <form action={signOutFormAction} className="inline">
              <button
                type="submit"
                className={`inline-flex min-h-11 items-center rounded-full px-4 text-[15px] font-medium text-ink underline underline-offset-4 hover:text-violet-hover ${FOCUS}`}
              >
                {copy.signOut}
              </button>
            </form>
          </noscript>
          <Link
            href="/#handle-builder-heading"
            className={`hidden min-h-11 items-center rounded-full bg-ink px-[18px] text-[15px] font-semibold text-white hover:bg-violet-hover sm:inline-flex ${FOCUS}`}
          >
            {brand.claimHandle}
          </Link>
        </div>
      </div>
    </nav>
  );
}
