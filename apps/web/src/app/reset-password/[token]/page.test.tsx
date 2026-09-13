import { render, screen } from "@testing-library/react";

import en from "../../../../../../packages/shared/messages/en.json";
import SetNewPasswordPage, { metadata } from "./page";

const lengths = jest.requireActual<{
  readonly PASSWORD_MIN_LENGTH: number;
  readonly PASSWORD_MAX_LENGTH: number;
}>("../../../../../../packages/core/src/auth/password-length");

jest.mock("@template/core", () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    "../../../../../../packages/core/src/auth/password-length",
  );
  return {
    PASSWORD_MIN_LENGTH: actual.PASSWORD_MIN_LENGTH,
    PASSWORD_MAX_LENGTH: actual.PASSWORD_MAX_LENGTH,
  };
});

jest.mock("../../../components/password-reset-action", () => ({
  setNewPasswordFormAction: jest.fn(),
}));

const copy = en.PasswordReset;
const TOKEN = "Abc123Token456Xyz789Qrst";

const renderPage = async (
  query: Record<string, string | string[] | undefined> = {},
) =>
  render(
    await SetNewPasswordPage({
      params: Promise.resolve({ token: TOKEN }),
      searchParams: Promise.resolve(query),
    }),
  );

describe("the set-new-password page (#192)", () => {
  it("carries the path segment's token into the form, as a hidden field", async () => {
    const { container } = await renderPage();

    const hidden = container.querySelector('input[type="hidden"]');
    expect(hidden).toHaveAttribute("name", "token");
    expect(hidden).toHaveAttribute("value", TOKEN);
  });

  it("is a labelled new-password field with the server's own length limits and a described hint", async () => {
    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: copy.setHeading }),
    ).toBeInTheDocument();
    const field = screen.getByLabelText(copy.newPasswordLabel);
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveAttribute("name", "password");
    expect(field).toHaveAttribute("autocomplete", "new-password");
    expect(field).toHaveAttribute(
      "minlength",
      String(lengths.PASSWORD_MIN_LENGTH),
    );
    expect(field).toHaveAttribute(
      "maxlength",
      String(lengths.PASSWORD_MAX_LENGTH),
    );
    expect(field).toBeRequired();
    expect(field).toHaveAccessibleDescription(
      `At least ${String(lengths.PASSWORD_MIN_LENGTH)} characters.`,
    );
    expect(
      screen.getByRole("button", { name: copy.setSubmit }),
    ).toHaveAttribute("type", "submit");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("sends no referrer to other sites and asks not to be indexed, because its address holds a token", () => {
    expect(metadata).toEqual({
      referrer: "same-origin",
      robots: { index: false, follow: false },
    });
  });

  it.each([
    [
      "too-short",
      `That password is too short. Use at least ${String(lengths.PASSWORD_MIN_LENGTH)} characters.`,
    ],
    [
      "too-long",
      `That password is too long. Use at most ${String(lengths.PASSWORD_MAX_LENGTH)} characters.`,
    ],
    ["failed", copy.setFailed],
  ])("announces %s, keeping the form", async (error, text) => {
    await renderPage({ error });

    expect(screen.getByRole("alert")).toHaveTextContent(text);
    expect(screen.getByLabelText(copy.newPasswordLabel)).toBeInTheDocument();
  });

  it("ignores an error it does not recognise", async () => {
    await renderPage({ error: "invalid-link" });

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
