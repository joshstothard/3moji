import { render, screen, within } from "@testing-library/react";

import * as termsModule from "./page";
import en from "../../../../../packages/shared/messages/en.json";

const TermsPage = termsModule.default;

/**
 * The terms of use ([#196](https://github.com/joshstothard/3moji/issues/196)),
 * asserted against the issue's acceptance criteria.
 */
const legal = en.Legal;
const copy = legal.Terms;
const sections = copy.sections;

const ADDRESS = "terms@example.com";
const savedAddress = process.env.REPORT_CONTACT_EMAIL;

function setAddress(value: string | undefined): void {
  if (value === undefined)
    Reflect.deleteProperty(process.env, "REPORT_CONTACT_EMAIL");
  else process.env.REPORT_CONTACT_EMAIL = value;
}

beforeEach(() => {
  setAddress(ADDRESS);
});

afterAll(() => {
  setAddress(savedAddress);
});

function sectionNamed(heading: string): HTMLElement {
  return screen.getByRole("region", { name: heading });
}

describe("the terms of use", () => {
  it("is headed as the terms of use", () => {
    render(<TermsPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: copy.heading }),
    ).toBeInTheDocument();
  });

  it("shows the draft marker until the owner removes it", () => {
    render(<TermsPage />);

    expect(screen.getByText(legal.draftMarker)).toBeVisible();
  });

  it.each(Object.values(sections).map((section) => section.heading))(
    "has a section headed %s",
    (heading) => {
      render(<TermsPage />);

      expect(sectionNamed(heading)).toBeInTheDocument();
    },
  );

  it("rules out phishing, malware, illegal content and impersonation on Profiles and Links", () => {
    render(<TermsPage />);

    const rules = within(sectionNamed(sections.acceptableUse.heading))
      .getAllByRole("listitem")
      .map((item) => item.textContent)
      .join("\n");
    for (const banned of [/phishing/, /malware/, /illegal/, /impersonat/]) {
      expect(rules).toMatch(banned);
    }
  });

  it("says Handles are not bought or sold", () => {
    render(<TermsPage />);

    expect(sectionNamed(sections.yourHandle.heading)).toHaveTextContent(
      /not bought or sold/,
    );
  });

  it("says a Profile breaching the terms can be removed", () => {
    render(<TermsPage />);

    expect(sectionNamed(sections.removal.heading)).toHaveTextContent(
      /remove a Profile/,
    );
  });

  it("gives no warranty", () => {
    render(<TermsPage />);

    expect(sectionNamed(sections.noWarranty.heading)).toHaveTextContent(
      /provided as it is/,
    );
  });

  it("names Joshua Stothard as the operator", () => {
    render(<TermsPage />);

    expect(sectionNamed(sections.aboutTheseTerms.heading)).toHaveTextContent(
      /run by Joshua Stothard/,
    );
    expect(document.body.textContent).not.toMatch(/Operator name/);
    expect(document.body.textContent).not.toMatch(/\{operator\}|\{contact\}/);
  });

  it("sets a minimum age of 16", () => {
    render(<TermsPage />);

    const whoCanUse = sectionNamed(sections.whoCanUse.heading);
    expect(whoCanUse).toHaveTextContent(/at least 16 years old/);
    expect(whoCanUse).not.toHaveTextContent(/\[/);
  });

  it("limits liability without excluding what UK law does not allow to be excluded", () => {
    render(<TermsPage />);

    expect(document.body.textContent).not.toMatch(
      /Limitation of liability wording/,
    );
    const liability = sectionNamed(copy.sections.liability.heading);
    for (const kept of [
      /death or personal injury caused by our negligence/,
      /fraud/,
      /anything else the law does not allow us to exclude or limit/,
    ]) {
      expect(liability).toHaveTextContent(kept);
    }
  });

  it("says the law of England and Wales applies", () => {
    render(<TermsPage />);

    expect(document.body.textContent).toMatch(
      /law of England and Wales applies/,
    );
  });

  it("says when it was last updated", () => {
    render(<TermsPage />);

    expect(sectionNamed(sections.changes.heading)).toHaveTextContent(
      /Last updated: 14 September 2026/,
    );
  });

  describe("the contact address", () => {
    it("links every mention to REPORT_CONTACT_EMAIL as a mailto link", () => {
      render(<TermsPage />);

      for (const section of [sections.aboutTheseTerms, sections.removal]) {
        expect(
          within(sectionNamed(section.heading)).getByRole("link", {
            name: ADDRESS,
          }),
        ).toHaveAttribute("href", `mailto:${ADDRESS}`);
      }
      expect(screen.queryByText(legal.contactPlaceholder)).toBeNull();
    });

    it.each([
      ["unset", undefined],
      ["refused", `${ADDRESS}\r\nCc: someone@example.net`],
    ])(
      "keeps the bracketed placeholder, with no link, when the address is %s",
      (_case, value) => {
        setAddress(value);
        render(<TermsPage />);

        const about = sectionNamed(sections.aboutTheseTerms.heading);
        expect(about).toHaveTextContent(legal.contactPlaceholder);
        expect(within(about).queryByRole("link")).toBeNull();
        expect(document.body.innerHTML).not.toMatch(/mailto:/);
      },
    );

    it("is rendered per request, so a changed address needs no rebuild", () => {
      const dynamic: unknown = Reflect.get(termsModule, "dynamic");

      expect(dynamic).toBe("force-dynamic");
    });
  });

  it("links to the privacy notice", () => {
    render(<TermsPage />);

    expect(
      screen.getByRole("link", { name: copy.relatedLink }),
    ).toHaveAttribute("href", "/privacy");
  });
});
