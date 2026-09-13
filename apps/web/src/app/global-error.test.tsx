import { renderToStaticMarkup } from "react-dom/server";

import GlobalError from "./global-error";
import { THROWN_DETAILS, thrownError } from "../test-support/thrown-error";
import en from "../../../../packages/shared/messages/en.json";

/**
 * The last-resort error page ([#203](https://github.com/joshstothard/3moji/issues/203)).
 *
 * Next.js renders it only when the root layout itself fails, and it **replaces**
 * that layout, so it has to be a whole document: `<html lang>`, `<body>` and a
 * title of its own. What it says and offers is the shared `ErrorNotice`, whose
 * retry and home link `error.test.tsx` exercises.
 */
const copy = en.ErrorPage;

function markup(): string {
  return renderToStaticMarkup(
    <GlobalError error={thrownError()} retry={jest.fn()} />,
  );
}

describe("GlobalError", () => {
  it("renders a whole document in English, because it replaces the root layout", () => {
    const html = markup();

    expect(html).toMatch(/^<html lang="en"/);
    expect(html).toContain("<body");
    expect(html).toContain(`<title>${copy.metaTitle}</title>`);
  });

  it("says something went wrong, with a retry and a link home", () => {
    const html = markup();

    expect(html).toContain(`>${copy.heading}</h1>`);
    expect(html).toMatch(new RegExp(`<button[^>]*>${copy.retry}</button>`));
    expect(html).toMatch(new RegExp(`<a[^>]*href="/"[^>]*>${copy.home}</a>`));
  });

  it.each(THROWN_DETAILS)("never shows %p", (detail) => {
    expect(markup()).not.toContain(detail);
  });
});
