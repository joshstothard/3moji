import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { findHandleAlias } from "@template/core";

import { HandleLookup } from "../../components/handle-lookup";
import en from "../../../../../packages/shared/messages/en.json";

const copy = en.FindPage;

/**
 * Where the "Find a Handle" form lands: `/find?q=ice cube ice cube ice cube`
 * ([#200](https://github.com/joshstothard/3moji/issues/200)).
 *
 * A thin adapter, as every route is under ADR-0006: `findHandleAlias` in
 * `packages/core` splits the words into readings and resolves each through
 * `resolveAlias`; this page only turns its answer into a response.
 *
 * - **Found** is a redirect to the alias path — `/ice-cube.ice-cube.ice-cube`
 *   — and that page decides everything else exactly as it does for a pasted
 *   link: one Profile rendered in place, a listing when several are claimed,
 *   the claim call to action when none is (ADR-0008 decision 4). So the lookup
 *   reveals nothing a visitor could not learn by visiting that path, and the
 *   address bar ends on the shareable ASCII link rather than here. The alias
 *   is built from slugs and dots alone, so the path cannot leave this origin.
 * - **Not found** renders here, with the lookup again and the words already in
 *   it. It is the same message for words we do not know and for words with
 *   two readings naming different Handles, and it suggests the dots that
 *   settle the second.
 *
 * **A page rather than a route handler**, so the not-found answer is a real
 * page with a heading, a landmark and a title, reached in one request with or
 * without JavaScript. It is therefore not an API boundary in
 * `lib/api-boundaries.test.ts`, which enumerates route handlers and server
 * actions — the same as `[handle]/page.tsx`.
 *
 * `redirect` signals by throwing, so nothing here catches around it.
 */
interface FindPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** What a visitor typed, whatever it looks like: this page never trusts it. */
function typedWordsOf(value: string | string[] | undefined): string {
  return (typeof value === "string" ? value : value?.[0]) ?? "";
}

/**
 * Kept out of search indexes: the page's only content is whatever somebody
 * typed into a query string.
 */
export const metadata: Metadata = {
  title: copy.title,
  robots: { index: false },
};

export default async function FindPage({ searchParams }: FindPageProps) {
  const query = await searchParams;
  const typed = typedWordsOf(query.q);

  if (typed.trim() === "") {
    // Nothing to look up — a bare `/find`. The lookup lives on the home page.
    redirect("/");
  }

  const lookup = findHandleAlias(typed);
  if (lookup.found) {
    redirect(`/${lookup.alias}`);
  }

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <h1 className="text-3xl font-bold text-ink mb-3 tracking-tight">
        {copy.notFoundHeading}
      </h1>
      <p className="text-base text-body">{copy.notFound}</p>

      <HandleLookup defaultValue={typed} />
    </main>
  );
}
