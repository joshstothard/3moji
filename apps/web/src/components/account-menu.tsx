"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import en from "../../../../packages/shared/messages/en.json";
import { signOutFormAction } from "./sign-out-action";

const copy = en.AccountMenu;

/**
 * What `GET /api/viewer` answers, as this component reads it.
 *
 * **Declared here, not imported from `@template/core`.** It is `viewerSummary`'s
 * answer, but the root entry point cannot be bundled for the browser and the
 * browser entry point may not reach `src/auth`
 * (`packages/core/src/browser.test.ts`). It is also a boundary: the JSON
 * arrives as `unknown` and {@link summaryFrom} checks every field. The shape is
 * held equal to `ViewerSummary` at compile time in `account-menu.test.tsx`.
 */
export type ViewerAnswer =
  | { readonly state: "signed-out" }
  | { readonly state: "signed-in" }
  | {
      readonly state: "owner";
      readonly key: string;
      readonly encoded: string;
    };

/**
 * Fired on `window` when something changes who is signed in without changing
 * the page — a sign-out (#194) that lands back on the page it started from is
 * the case this exists for. The indicator already asks again on every
 * navigation.
 *
 * ```ts
 * window.dispatchEvent(new Event(VIEWER_CHANGED_EVENT));
 * ```
 */
export const VIEWER_CHANGED_EVENT = "3moji:viewer-changed";

/** Where the indicator asks. `app/api/viewer/route.ts`. */
const VIEWER_ROUTE = "/api/viewer";

/**
 * A Handle's percent-encoded path segment: `%XX` escapes and nothing else.
 *
 * Checked in the browser as well as built on the server, because the answer
 * becomes an `href`. A segment that is anything else — a `/`, a scheme, a
 * stray character — is not a Handle this route could have produced, and is
 * refused rather than linked.
 */
const ENCODED_SEGMENT = /^(?:%[0-9A-F]{2})+$/;

const SIGNED_OUT: ViewerAnswer = { state: "signed-out" };

/**
 * Reads the route's JSON as a {@link ViewerAnswer}. The body is `unknown`
 * until each field is checked, and **anything unexpected is signed-out**, the
 * answer that shows nobody's links.
 */
function summaryFrom(body: unknown): ViewerAnswer {
  if (typeof body !== "object" || body === null || !("state" in body)) {
    return SIGNED_OUT;
  }
  if (body.state === "signed-in") return { state: "signed-in" };
  if (body.state !== "owner") return SIGNED_OUT;

  if (
    !("key" in body) ||
    typeof body.key !== "string" ||
    !("encoded" in body) ||
    typeof body.encoded !== "string" ||
    !ENCODED_SEGMENT.test(body.encoded)
  ) {
    return SIGNED_OUT;
  }

  // The key is rendered as text and never linked; the link is `encoded`,
  // checked above.
  return { state: "owner", key: body.key, encoded: body.encoded };
}

/**
 * The navbar's signed-in indicator
 * ([#193](https://github.com/joshstothard/3moji/issues/193)).
 *
 * **A client island, so that no page reads the session.** The server renders
 * nothing here, identically for every visitor; after hydration this asks
 * `GET /api/viewer` who is looking. The public Profile's HTML is therefore the
 * same bytes for a signed-out visitor, a stranger and its owner — the page
 * cannot leak an owner-only link because the page never knows who asked.
 * Until the answer arrives nothing focusable is rendered, so there is no
 * unnamed control for axe to find and no tab stop that moves.
 *
 * **It asks again on every navigation.** The root layout stays mounted across
 * App Router navigations, including the redirect after signing in, so asking
 * once would leave "Sign in" showing after a successful sign-in.
 * {@link VIEWER_CHANGED_EVENT} covers a change that stays on one page.
 *
 * **It decides links, never permission.** The edit page and
 * `saveProfileAction` enforce `profileEditAuthority` themselves, so a stale or
 * forged answer here can show a link that 404s and nothing more.
 *
 * **A disclosure, not a menu.** A button with `aria-expanded` over a plain
 * list of links: Tab moves through them, Escape closes and returns focus. A
 * `role="menu"` would promise arrow-key navigation this does not need.
 */
export function AccountMenu() {
  const pathname = usePathname();
  const [shown, setShown] = useState<ViewerAnswer | undefined>(undefined);
  /**
   * The page the list was opened on, or `undefined` while it is closed. The
   * list is open only while that is still the current page, so a navigation
   * closes it without an effect — the links in it go somewhere.
   */
  const [openedOn, setOpenedOn] = useState<string | undefined>(undefined);
  const open = openedOn !== undefined && openedOn === pathname;
  const [asked, setAsked] = useState(0);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    const askAgain = () => {
      setAsked((count) => count + 1);
    };
    window.addEventListener(VIEWER_CHANGED_EVENT, askAgain);
    return () => {
      window.removeEventListener(VIEWER_CHANGED_EVENT, askAgain);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const read = async (): Promise<void> => {
      try {
        const response = await fetch(VIEWER_ROUTE, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        const summary = response.ok
          ? summaryFrom(await response.json())
          : SIGNED_OUT;
        if (!controller.signal.aborted) setShown(summary);
      } catch {
        // Offline, refused, not JSON or aborted. Aborted means a newer read is
        // on its way; anything else shows the sign-in link, which is nobody's.
        if (!controller.signal.aborted) setShown(SIGNED_OUT);
      }
    };

    void read();
    return () => {
      controller.abort();
    };
  }, [pathname, asked]);

  const closeOnEscape = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    setOpenedOn(undefined);
    toggleRef.current?.focus();
  }, []);

  if (shown === undefined) return null;

  if (shown.state === "signed-out") {
    return (
      <Link
        href="/sign-in"
        className="rounded-xl px-3 py-2 text-base font-semibold text-indigo-700 underline hover:text-indigo-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        {copy.signIn}
      </Link>
    );
  }

  return (
    // The Escape handler sits on the wrapper so it works from the toggle and
    // from any link inside the list; the wrapper itself is not interactive.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="relative" onKeyDown={closeOnEscape}>
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setOpenedOn(open ? undefined : pathname);
        }}
        className="flex items-center gap-2 rounded-xl border border-slate-500 bg-white px-3 py-2 text-base font-semibold text-slate-900 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        {shown.state === "owner" && (
          // The Profile link below names the Handle's page for assistive
          // technology; here the emoji are decoration beside the label.
          <span aria-hidden="true">{shown.key}</span>
        )}
        {copy.toggle}
      </button>

      {open && (
        <div
          id={listId}
          className="absolute right-0 mt-2 min-w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-sm"
        >
          {shown.state === "owner" ? (
            <ul className="flex flex-col">
              <li>
                <AccountLink href={`/${shown.encoded}`}>
                  {copy.yourProfile}
                </AccountLink>
              </li>
              <li>
                <AccountLink href={`/${shown.encoded}/edit`}>
                  {copy.editProfile}
                </AccountLink>
              </li>
            </ul>
          ) : (
            <p className="px-3 py-2 text-base text-slate-700">
              {copy.noHandle}
            </p>
          )}
          <SignOutForm />
          {/*
           * Account deletion (#195) attaches here: a link to an owner page
           * that reads the session server-side, never a control on this island.
           */}
        </div>
      )}
    </div>
  );
}

/**
 * Sign-out ([#194](https://github.com/joshstothard/3moji/issues/194)), below
 * the links in both signed-in states.
 *
 * **A form's submit button, never a link**, so signing out is always a POST.
 * The same action is in the navbar's `<noscript>`, which is how a visitor
 * without JavaScript signs out: this island never runs for them.
 *
 * The action lands on `/`. When that is the page it started from, the
 * pathname does not change and nothing would ask `GET /api/viewer` again, so
 * {@link VIEWER_CHANGED_EVENT} is dispatched once the request settles —
 * **whether or not it succeeded**, because asking again is how the indicator
 * shows what is true. A request that could not be sent is not rethrown: there
 * is no error to show beyond the indicator still saying "Signed in".
 */
function SignOutForm() {
  const signOutAndAskAgain = async (): Promise<void> => {
    try {
      await signOutFormAction();
    } catch {
      // Offline or refused. The session may be intact; asking again says so.
    } finally {
      window.dispatchEvent(new Event(VIEWER_CHANGED_EVENT));
    }
  };

  return (
    <form
      action={signOutAndAskAgain}
      className="mt-2 border-t border-slate-200 pt-2"
    >
      <button
        type="submit"
        className="block w-full rounded-lg px-3 py-2 text-left text-base text-slate-900 underline hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        {copy.signOut}
      </button>
    </form>
  );
}

function AccountLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-lg px-3 py-2 text-base text-slate-900 underline hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
    >
      {children}
    </Link>
  );
}
