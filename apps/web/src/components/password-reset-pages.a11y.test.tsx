import { render } from "@testing-library/react";

import ResetPasswordPage from "../app/reset-password/page";
import SetNewPasswordPage from "../app/reset-password/[token]/page";
import SignInPage from "../app/sign-in/page";
import { checkAccessibility } from "../test-support/axe";

/**
 * The password reset pages, and the sign-in page that now links to them,
 * checked by axe for WCAG 2 A and AA
 * ([#192](https://github.com/joshstothard/3moji/issues/192)).
 *
 * Each page idle and in every state it can announce, because an announcement is
 * where a live region with no name, or a hint referenced by an id that is not
 * there, would show. The rendered-page check in `accessibility.spec.ts` covers
 * what jsdom cannot: contrast, target size and the page-level rules.
 */
jest.mock("@template/core", () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    "../../../../packages/core/src/auth/password-length",
  );
  return {
    PASSWORD_MIN_LENGTH: actual.PASSWORD_MIN_LENGTH,
    PASSWORD_MAX_LENGTH: actual.PASSWORD_MAX_LENGTH,
  };
});
jest.mock("./password-reset-action", () => ({
  requestPasswordResetFormAction: jest.fn(),
  setNewPasswordFormAction: jest.fn(),
}));
jest.mock("./sign-in-action", () => ({ signInFormAction: jest.fn() }));

type Query = Record<string, string | string[] | undefined>;

async function expectAccessible(
  element: React.ReactElement,
  rules: readonly string[],
): Promise<void> {
  const { container, unmount } = render(element);
  const report = await checkAccessibility(container);
  unmount();

  expect(report.violations).toEqual([]);
  expect(report.incomplete).toEqual([]);
  expect(report.passed).toEqual(expect.arrayContaining([...rules]));
}

describe("the password reset pages, checked by axe", () => {
  it.each<Query>([
    {},
    { notice: "sent" },
    { notice: "invalid" },
    { notice: "rate-limited" },
    { notice: "failed" },
    { notice: "link-invalid" },
  ])("the request form reports no violations with %j", async (query) => {
    await expectAccessible(
      await ResetPasswordPage({ searchParams: Promise.resolve(query) }),
      ["label", "button-name", "autocomplete-valid", "link-name"],
    );
  });

  it.each<Query>([
    {},
    { error: "too-short" },
    { error: "too-long" },
    { error: "failed" },
  ])(
    "the set-new-password form reports no violations with %j",
    async (query) => {
      await expectAccessible(
        await SetNewPasswordPage({
          params: Promise.resolve({ token: "Abc123Token456Xyz789Qrst" }),
          searchParams: Promise.resolve(query),
        }),
        [
          "label",
          "button-name",
          "autocomplete-valid",
          "link-name",
          "aria-valid-attr-value",
        ],
      );
    },
  );

  it.each<Query>([{}, { notice: "password-reset" }])(
    "the sign-in page, with its reset link, reports no violations with %j",
    async (query) => {
      await expectAccessible(
        await SignInPage({ searchParams: Promise.resolve(query) }),
        ["label", "button-name", "link-name"],
      );
    },
  );
});
