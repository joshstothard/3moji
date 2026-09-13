import { render } from "@testing-library/react";
import type { ViewerSummary } from "@template/core";

import { checkAccessibility } from "../../test-support/axe";

/**
 * The account page, checked by axe for WCAG 2 A and AA
 * ([#195](https://github.com/joshstothard/3moji/issues/195)), idle and with
 * each refusal it can announce. Contrast, target size and the page-level rules
 * are checked on the rendered page in `e2e/account-deletion.spec.ts`.
 */
const ICE = "\u{1F9CA}\u{1F9CA}\u{1F9CA}";
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";

const summary: ViewerSummary = { state: "owner", key: ICE, encoded: ENCODED };
jest.mock("../../lib/viewer", () => ({
  readViewerSummary: () => Promise.resolve(summary),
}));
jest.mock("../../components/account-delete-action", () => ({
  deleteAccountAction: jest.fn(),
}));

import AccountPage from "./page";

describe("the account page, checked by axe", () => {
  it.each<Record<string, string>>([
    {},
    { error: "confirm" },
    { error: "failed" },
  ])("reports no violations with %j", async (query) => {
    const { container } = render(
      await AccountPage({ searchParams: Promise.resolve(query) }),
    );
    const report = await checkAccessibility(container);

    expect(report.violations).toEqual([]);
    expect(report.incomplete).toEqual([]);
    expect(report.passed).toEqual(
      expect.arrayContaining(["label", "button-name", "list", "listitem"]),
    );
  });
});
