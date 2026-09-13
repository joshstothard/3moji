import type { Metadata } from "next";
import Link from "next/link";

import en from "../../../../packages/shared/messages/en.json";

/**
 * The branded 404 (#203), for an unknown path and for every `notFound()`.
 *
 * It renders inside the root layout, so it has the navbar and footer. **It
 * reads nothing from the request**: a response that became dynamic could be
 * streamed, and a streamed response has sent its status before this page can
 * set one, so the 404 would reach the wire as a 200. `e2e/error-pages.spec.ts`
 * asserts the status.
 *
 * It changes no route's answer. `[handle]` still decides what is a Handle, a
 * word alias or neither; a reserved Handle such as `/🍕🍕🍕` still resolves with
 * 200, and only what already answered 404 is shown this page.
 */
const copy = en.NotFoundPage;

export const metadata: Metadata = { title: copy.metaTitle };

export default function NotFound() {
  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
        {copy.heading}
      </h1>
      <p className="mt-4 text-lg text-slate-600">{copy.body}</p>
      <Link
        href="/"
        className="mt-8 inline-block rounded-xl bg-indigo-600 px-5 py-3 text-base font-semibold text-white shadow-sm hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        {copy.home}
      </Link>
    </main>
  );
}
