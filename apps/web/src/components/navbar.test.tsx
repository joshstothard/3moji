import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import en from "../../../../packages/shared/messages/en.json";

// The sign-out server action (#194): the navbar renders its form, never runs it.
jest.mock("./sign-out-action", () => ({
  signOutFormAction: (): Promise<void> => Promise.resolve(),
}));

jest.mock("./account-menu", () => ({
  AccountMenu: () => <div data-testid="account-menu" />,
}));

import { Navbar } from "./navbar";

describe("Navbar", () => {
  it("renders the product name linking home", () => {
    render(<Navbar />);
    expect(screen.getByRole("link", { name: "3moji" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("offers no links to the removed OKR sections", () => {
    render(<Navbar />);
    const hrefs = screen
      .queryAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/objectives");
    expect(hrefs).not.toContain("/dashboard");
  });

  it("mentions no OKR concepts", () => {
    const { container } = render(<Navbar />);
    expect(container.textContent).not.toMatch(/okr|objective|dashboard/i);
  });

  /**
   * #193: the signed-in indicator lives in the navbar, on every page, as a
   * client island — so the navbar the server renders is the same for every
   * visitor.
   */
  it("carries the signed-in indicator inside the navigation landmark", () => {
    render(<Navbar />);

    expect(screen.getByRole("navigation")).toContainElement(
      screen.getByTestId("account-menu"),
    );
  });

  it("offers a visitor without JavaScript a sign-in link, the same for everybody", () => {
    const markup = renderToStaticMarkup(<Navbar />);

    expect(markup).toMatch(
      new RegExp(
        `<noscript><a[^>]*href="/sign-in"[^>]*>${en.AccountMenu.signIn}</a>`,
      ),
    );
  });

  it("names nobody's Handle in the markup it renders", () => {
    const markup = renderToStaticMarkup(<Navbar />);

    expect(markup).not.toMatch(/%F0%9F|\/edit"/);
  });

  /**
   * #194. Without JavaScript the island never runs, so sign-out has to be in
   * the `<noscript>` too — as a form, the same markup for every visitor, never
   * a link a third-party page could make a browser follow.
   */
  it("offers a visitor without JavaScript a sign-out form, never a sign-out link", () => {
    const markup = renderToStaticMarkup(<Navbar />);
    const noscript = /<noscript>([\s\S]*)<\/noscript>/.exec(markup)?.[1] ?? "";

    expect(noscript).toMatch(
      new RegExp(
        `<form[^>]*>[\\s\\S]*<button[^>]*type="submit"[^>]*>${en.AccountMenu.signOut}</button>[\\s\\S]*</form>`,
      ),
    );
    expect(noscript).not.toMatch(
      new RegExp(`<a[^>]*>${en.AccountMenu.signOut}</a>`),
    );
  });
});
