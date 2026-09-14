import { render } from "@testing-library/react";

import PrivacyPage from "../app/privacy/page";
import TermsPage from "../app/terms/page";
import { checkAccessibility } from "../test-support/axe";

/**
 * The privacy notice and the terms of use, checked by axe for WCAG 2 A and AA
 * ([#196](https://github.com/joshstothard/3moji/issues/196)).
 *
 * Contrast, target size and the page-level rules need a real browser, and run
 * in `e2e/accessibility.spec.ts`; this is the structural half.
 */
const savedAddress = process.env.REPORT_CONTACT_EMAIL;

afterAll(() => {
  if (savedAddress === undefined)
    Reflect.deleteProperty(process.env, "REPORT_CONTACT_EMAIL");
  else process.env.REPORT_CONTACT_EMAIL = savedAddress;
});

describe("the legal pages, checked by axe", () => {
  it.each([
    ["the privacy notice", PrivacyPage],
    ["the terms of use", TermsPage],
  ])("%s reports no violations", async (_name, Page) => {
    Reflect.deleteProperty(process.env, "REPORT_CONTACT_EMAIL");
    const { container } = render(<Page />);

    const report = await checkAccessibility(container);

    expect(report.violations).toEqual([]);
    expect(report.incomplete).toEqual([]);
    expect(report.passed).toEqual(
      expect.arrayContaining(["list", "listitem", "link-name"]),
    );
  });
  it.each([
    ["the privacy notice", PrivacyPage],
    ["the terms of use", TermsPage],
  ])(
    "%s reports no violations with its contact links (#242)",
    async (_name, Page) => {
      process.env.REPORT_CONTACT_EMAIL = "contact@example.com";
      const { container } = render(<Page />);

      const report = await checkAccessibility(container);

      expect(report.violations).toEqual([]);
      expect(report.incomplete).toEqual([]);
      expect(container.querySelector('a[href^="mailto:"]')).not.toBeNull();
      expect(report.passed).toEqual(expect.arrayContaining(["link-name"]));
    },
  );
});
