"use client";

import Link from "next/link";

import en from "../../../../packages/shared/messages/en.json";

const copy = en.ErrorPage;

/**
 * What both error pages say and offer (#203): that something went wrong, a
 * retry, and a way home.
 *
 * **It is never given the error.** Next.js hands an error boundary the thrown
 * value — in development still carrying its message, in production a digest —
 * and the only way to be sure none of it reaches the screen is for the
 * component that renders the screen not to have it. Nor does the browser log
 * it: a failure belongs in the server's logs (`lib/request-error.ts`).
 */
export function ErrorNotice({ retry }: { readonly retry: () => void }) {
  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-ink">
        {copy.heading}
      </h1>
      <p className="mt-4 text-lg text-body">{copy.body}</p>
      <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
        <button
          type="button"
          onClick={retry}
          className="rounded-full bg-violet px-5 py-3 text-base font-semibold text-white shadow-sm hover:bg-violet-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet"
        >
          {copy.retry}
        </button>
        <Link
          href="/"
          className="rounded-2xl px-5 py-3 text-base font-semibold text-violet underline underline-offset-4 hover:text-violet focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet"
        >
          {copy.home}
        </Link>
      </div>
    </main>
  );
}
