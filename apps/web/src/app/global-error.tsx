"use client";

import { ErrorNotice } from "../components/error-notice";
import en from "../../../../packages/shared/messages/en.json";
import "./globals.css";

/**
 * The last-resort error page (#203), for a failure in the root layout itself.
 *
 * It **replaces** that layout, so it is kept minimal: its own `<html lang>`,
 * `<body>`, title and stylesheet, and no navbar or footer — the layout that
 * renders them is what failed. What it says is the same `ErrorNotice` as
 * `error.tsx`, and like that page it reads only `retry`, never the error.
 */
export default function GlobalError({
  retry,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly retry: () => void;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-slate-50 antialiased">
        <title>{en.ErrorPage.metaTitle}</title>
        <ErrorNotice retry={retry} />
      </body>
    </html>
  );
}
