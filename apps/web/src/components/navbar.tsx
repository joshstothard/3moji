import Link from "next/link";

import en from "../../../../packages/shared/messages/en.json";
import { AccountMenu } from "./account-menu";

const copy = en.AccountMenu;

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
 */
export function Navbar() {
  return (
    <nav className="bg-white border-b border-slate-200 sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4 h-16">
          <Link
            href="/"
            className="font-bold text-slate-900 text-lg tracking-tight"
          >
            3moji
          </Link>
          <div className="flex items-center">
            <AccountMenu />
            <noscript>
              <Link
                href="/sign-in"
                className="rounded-xl px-3 py-2 text-base font-semibold text-indigo-700 underline hover:text-indigo-800"
              >
                {copy.signIn}
              </Link>
            </noscript>
          </div>
        </div>
      </div>
    </nav>
  );
}
