import { render, screen, within } from "@testing-library/react";

import TermsPage from "./page";
import en from "../../../../../packages/shared/messages/en.json";

/**
 * The terms of use ([#196](https://github.com/joshstothard/3moji/issues/196)),
 * asserted against the issue's acceptance criteria.
 */
const legal = en.Legal;
const copy = legal.Terms;
const sections = copy.sections;

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

  it("identifies the operator only by a marked placeholder", () => {
    render(<TermsPage />);

    expect(sectionNamed(sections.aboutTheseTerms.heading)).toHaveTextContent(
      legal.operatorPlaceholder,
    );
    expect(document.body.textContent).not.toMatch(/\{operator\}|\{contact\}/);
  });

  it("links to the privacy notice", () => {
    render(<TermsPage />);

    expect(
      screen.getByRole("link", { name: copy.relatedLink }),
    ).toHaveAttribute("href", "/privacy");
  });
});
