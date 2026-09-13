import { reportLinkOf } from "../lib/report-link";
import en from "../../../../packages/shared/messages/en.json";

/**
 * "Report this page", on a claimed Handle's page
 * ([#197](https://github.com/joshstothard/3moji/issues/197)).
 *
 * A server component with no state and no client code: a plain `mailto:` link,
 * so it works with JavaScript disabled and adds nothing to the browser bundle.
 * The href is built on the server by `lib/report-link.ts` from configuration
 * and the canonical path alone, so the page stays the same for every visitor.
 *
 * **Nothing is rendered when there is no usable address** — no dead link, and
 * no copy telling somebody to report a page with no way to do it.
 */
export function ReportLink({ encoded }: { readonly encoded: string }) {
  const href = reportLinkOf(encoded);
  if (href === undefined) return null;

  return (
    <p className="mt-10 text-center text-sm">
      <a
        href={href}
        className="text-slate-600 underline hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        {en.HandlePage.report}
      </a>
    </p>
  );
}
