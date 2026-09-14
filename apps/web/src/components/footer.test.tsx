import { render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

import { Footer } from "./footer";
import { checkAccessibility } from "../test-support/axe";
import en from "../../../../packages/shared/messages/en.json";

/**
 * The footer on every page
 * ([#198](https://github.com/joshstothard/3moji/issues/198)): the privacy
 * notice, the terms of use, a way to report a page, and the Twemoji credit the
 * CC-BY 4.0 licence asks for.
 *
 * **It must not vary a page by viewer.** It is rendered by the root layout, so
 * a footer that read a header or a cookie would make every page — the public
 * Profile included — dynamic per request. `next/headers` is mocked only so the
 * suite can assert it is never called.
 */
const headers = jest.fn(() => {
  throw new Error("The footer read request headers.");
});
const cookies = jest.fn(() => {
  throw new Error("The footer read cookies.");
});
jest.mock("next/headers", () => ({
  headers: () => headers(),
  cookies: () => cookies(),
}));

const copy = en.Footer;
const ADDRESS = "reports@example.com";
const LICENCE_URL = "https://creativecommons.org/licenses/by/4.0/";

const savedAddress = process.env.REPORT_CONTACT_EMAIL;

function setAddress(value: string | undefined): void {
  if (value === undefined)
    Reflect.deleteProperty(process.env, "REPORT_CONTACT_EMAIL");
  else process.env.REPORT_CONTACT_EMAIL = value;
}

beforeEach(() => {
  setAddress(ADDRESS);
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_APP_VERSION;
});

afterAll(() => {
  setAddress(savedAddress);
});

const legalNav = () =>
  screen.getByRole("navigation", { name: copy.legalNavLabel });

describe("Footer", () => {
  it("renders the UI version", () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "9.9.9";
    render(<Footer />);
    expect(screen.getByText(/UI: v9\.9\.9/)).toBeInTheDocument();
  });

  it("falls back to 0.0.0 when the version is unset", () => {
    render(<Footer />);
    expect(screen.getByText(/UI: v0\.0\.0/)).toBeInTheDocument();
  });

  it("shows no API version, because there is no API", () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "9.9.9";
    const { container } = render(<Footer />);
    expect(container.textContent).not.toMatch(/API/i);
  });

  it("signs off with the wordmark and the tagline (#251)", () => {
    render(<Footer />);
    const footer = screen.getByRole("contentinfo");

    expect(within(footer).getByText(en.Brand.wordmark)).toBeInTheDocument();
    expect(within(footer).getByText(copy.tagline)).toBeInTheDocument();
  });

  it("is the page's contentinfo landmark", () => {
    render(<Footer />);

    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("links to the privacy notice and the terms of use", () => {
    render(<Footer />);

    expect(
      within(legalNav()).getByRole("link", { name: copy.privacy }),
    ).toHaveAttribute("href", "/privacy");
    expect(
      within(legalNav()).getByRole("link", { name: copy.terms }),
    ).toHaveAttribute("href", "/terms");
  });

  it("offers a way to report a page, to the configured mailbox", () => {
    render(<Footer />);

    const report = within(legalNav()).getByRole("link", { name: copy.report });
    const href = report.getAttribute("href") ?? "";
    expect(href.startsWith(`mailto:${ADDRESS}?`)).toBe(true);
    expect(href).toContain(`subject=${encodeURIComponent(copy.reportSubject)}`);
  });

  it.each([
    ["unset", undefined],
    ["not one plain address", `${ADDRESS}?bcc=attacker@example.net`],
  ])(
    "shows no report entry when REPORT_CONTACT_EMAIL is %s",
    (_name, value) => {
      setAddress(value);
      render(<Footer />);

      expect(
        screen.queryByRole("link", { name: copy.report }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(copy.report)).not.toBeInTheDocument();
      // The legal links do not depend on it.
      expect(
        within(legalNav()).getByRole("link", { name: copy.privacy }),
      ).toBeInTheDocument();
    },
  );

  it("credits Twemoji under CC-BY 4.0, with a link to the licence", () => {
    render(<Footer />);
    const footer = screen.getByRole("contentinfo");

    expect(
      within(footer).getByRole("link", { name: copy.emojiCreditLicence }),
    ).toHaveAttribute("href", LICENCE_URL);
    expect(
      within(footer).getByRole("link", { name: copy.emojiCreditTwemoji }),
    ).toHaveAttribute("href", "https://github.com/jdecked/twemoji");
    // TASL: the title, the copyright holders and the licence, in one sentence.
    expect(footer.textContent).toContain("Twemoji 16.0.1");
    expect(footer.textContent).toContain(
      "© Twitter, Inc. and other contributors and jdecked and other contributors",
    );
    expect(footer.textContent).toContain("licensed under CC-BY 4.0.");
    expect(footer.textContent).not.toMatch(/\{\w+\}/);
  });

  it("reads no request headers or cookies, and renders the same for every visitor", () => {
    const first = renderToStaticMarkup(<Footer />);
    const second = renderToStaticMarkup(<Footer />);

    expect(headers).not.toHaveBeenCalled();
    expect(cookies).not.toHaveBeenCalled();
    expect(second).toBe(first);
  });

  it("reports no axe violations, with every link named", async () => {
    const { container } = render(<Footer />);

    const report = await checkAccessibility(container);

    expect(report.violations).toEqual([]);
    expect(report.incomplete).toEqual([]);
    expect(report.passed).toEqual(
      expect.arrayContaining(["link-name", "list", "listitem"]),
    );
  });
});
