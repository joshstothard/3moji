import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { deleteAccountAction } from "../../components/account-delete-action";
import { readViewerSummary } from "../../lib/viewer";
import en from "../../../../../packages/shared/messages/en.json";

const copy = en.AccountPage;

export const metadata: Metadata = {
  title: copy.metaTitle,
  robots: { index: false },
};

/**
 * **Rendered per request, never prerendered.** Nothing else here marks the page
 * dynamic at build time: `readViewer` swallows the error a session read throws
 * during prerender, and the signed-out redirect happens before `searchParams`
 * is read. Without this, `next build` baked the redirect to sign-in into a
 * static page served to every visitor.
 */
export const dynamic = "force-dynamic";

interface AccountPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Whitelisted, because a query string is public input that lands in copy. */
function errorFor(value: string | string[] | undefined): string | undefined {
  const candidate = typeof value === "string" ? value : value?.[0];
  if (candidate === "confirm") return copy.errorConfirm;
  if (candidate === "failed") return copy.errorFailed;
  return undefined;
}

/**
 * The signed-in person's account page, and the only way to delete an Account
 * ([#195](https://github.com/joshstothard/3moji/issues/195)).
 *
 * **It reads the session, and may.** It is a per-visitor page by nature, not
 * shared chrome or the public Profile, so reading who is signed in makes no
 * other page's response differ by visitor — the rule
 * `docs/architecture/auth.md` § Reading the session sets out. It reaches it
 * through `lib/viewer.ts`, the same answer the navbar's indicator gets.
 *
 * **Release is account deletion, and the page says so before anything else**
 * (ADR-0004 decision 5, whose consequences raise the bar on confirmation copy):
 * the Handle is given up, the Profile and its Links are deleted, and it cannot
 * be undone.
 *
 * **The confirmation is a typed word, and it works without JavaScript.** A
 * plain `<form>` posts to `deleteAccountAction`, which refuses unless the
 * field holds the word shown. A typed word rather than a second page because a
 * second page still ends in one POST that anybody can send without visiting
 * the first, so only a field the action checks is a confirmation the server
 * can hold anyone to. A word rather than the Handle itself because three emoji
 * cannot be typed on a physical keyboard.
 *
 * **It is not a guard on deletion.** The action checks the session itself; a
 * page can only withhold a form.
 */
export default async function AccountPage({ searchParams }: AccountPageProps) {
  const summary = await readViewerSummary();
  if (summary.state === "signed-out") redirect("/sign-in");

  const query = await searchParams;
  const error = errorFor(query.error);

  return (
    <main className="max-w-xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
        {copy.heading}
      </h1>

      {summary.state === "owner" && (
        <p className="mt-4 text-lg text-slate-700">
          {copy.yourHandle} <span className="text-2xl">{summary.key}</span>
        </p>
      )}

      <section
        aria-labelledby="delete-account-heading"
        className="mt-10 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h2
          id="delete-account-heading"
          className="text-2xl font-semibold text-slate-900"
        >
          {copy.deleteHeading}
        </h2>
        <p className="mt-3 text-base text-slate-700">{copy.deleteIntro}</p>
        <ul
          id="delete-account-consequences"
          className="mt-3 list-disc pl-6 text-base text-slate-900"
        >
          <li>{copy.consequenceHandle}</li>
          <li>{copy.consequenceProfile}</li>
          <li className="font-semibold">{copy.consequenceFinal}</li>
        </ul>

        {error !== undefined && (
          <p
            className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-base text-red-800"
            role="alert"
          >
            {error}
          </p>
        )}

        <form action={deleteAccountAction} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label
              className="text-base font-medium text-slate-700"
              htmlFor="delete-account-confirmation"
            >
              {copy.confirmLabel}{" "}
              <strong className="font-mono text-slate-900">
                {copy.confirmWord}
              </strong>
            </label>
            <input
              aria-describedby="delete-account-consequences"
              autoCapitalize="none"
              autoComplete="off"
              className="rounded-xl border border-slate-500 px-4 py-3 text-base text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              id="delete-account-confirmation"
              name="confirmation"
              required
              spellCheck={false}
              type="text"
            />
          </div>

          <button
            className="self-start rounded-xl bg-red-700 px-5 py-3 text-base font-semibold text-white hover:bg-red-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            type="submit"
          >
            {copy.submit}
          </button>
        </form>
      </section>
    </main>
  );
}
