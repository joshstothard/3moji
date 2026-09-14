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
    <p className="mt-4 text-center text-sm">
      {/* Muted, 4.75:1 on paper, and underlined: it is quiet, not hidden. */}
      <a
        href={href}
        className="inline-flex min-h-11 items-center text-muted underline underline-offset-4 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet"
      >
        {en.HandlePage.report}
      </a>
    </p>
  );
}
