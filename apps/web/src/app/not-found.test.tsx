import { render, screen } from "@testing-library/react";

import NotFound, { metadata } from "./not-found";
import { checkAccessibility } from "../test-support/axe";
import en from "../../../../packages/shared/messages/en.json";

/**
 * The branded 404 ([#203](https://github.com/joshstothard/3moji/issues/203)).
 *
 * It renders inside the root layout, so the navbar and footer come from there
 * and `e2e/error-pages.spec.ts` proves they appear, with the 404 status, on the
 * wire. This proves what the page itself says and links to.
 *
 * **It must not read the request.** A not-found page that touched a header or
 * a cookie would make the response dynamic, and a streamed response has sent
 * its status before the page can set one: the 404 would arrive as a 200.
 */
const headers = jest.fn(() => {
  throw new Error("The not-found page read request headers.");
});
const cookies = jest.fn(() => {
  throw new Error("The not-found page read cookies.");
});
jest.mock("next/headers", () => ({
  headers: () => headers(),
  cookies: () => cookies(),
}));

const copy = en.NotFoundPage;
const lookupCopy = en.HandleLookup;

describe("NotFound", () => {
  it("says there is nothing at this address, as the page's only level-one heading", () => {
    render(<NotFound />);

    expect(
      screen.getByRole("heading", { level: 1, name: copy.heading }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText(copy.body)).toBeInTheDocument();
  });

  it("keeps its headings in order: the page's h1, then the lookup's h2 (#201)", () => {
    render(<NotFound />);

    expect(
      screen.getAllByRole("heading").map((heading) => heading.tagName),
    ).toEqual(["H1", "H2"]);
    expect(
      screen.getByRole("heading", { level: 2, name: lookupCopy.heading }),
    ).toBeInTheDocument();
  });

  it("offers the Find a Handle lookup, empty, as the page's one search landmark (#201)", () => {
    render(<NotFound />);

    const search = screen.getByRole("search", { name: lookupCopy.heading });
    expect(screen.getAllByRole("search")).toHaveLength(1);
    expect(search).toHaveAttribute("action", "/find");
    expect(search).toHaveAttribute("method", "get");
    expect(
      screen.getByRole("searchbox", { name: lookupCopy.label }),
    ).toHaveValue("");
  });

  it("links home", () => {
    render(<NotFound />);

    expect(screen.getByRole("link", { name: copy.home })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("is the page's main landmark", () => {
    render(<NotFound />);

    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("titles the document", () => {
    expect(metadata.title).toBe(copy.metaTitle);
  });

  it("reads no request data", () => {
    render(<NotFound />);

    expect(headers).not.toHaveBeenCalled();
    expect(cookies).not.toHaveBeenCalled();
  });

  it("has no WCAG A or AA violations", async () => {
    const { container } = render(<NotFound />);

    const report = await checkAccessibility(container);

    expect(report.violations).toEqual([]);
    expect(report.incomplete).toEqual([]);
    expect(report.passed).toEqual(
      expect.arrayContaining(["link-name", "label", "button-name"]),
    );
  });
});
