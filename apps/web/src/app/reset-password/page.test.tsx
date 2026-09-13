import { render, screen } from "@testing-library/react";

import en from "../../../../../packages/shared/messages/en.json";
import ResetPasswordPage from "./page";

jest.mock("../../components/password-reset-action", () => ({
  requestPasswordResetFormAction: jest.fn(),
}));

const copy = en.PasswordReset;

const renderPage = async (
  query: Record<string, string | string[] | undefined> = {},
) => render(await ResetPasswordPage({ searchParams: Promise.resolve(query) }));

describe("the password reset request page (#192)", () => {
  it("is a labelled email form a keyboard can complete, with nothing announced yet", async () => {
    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: copy.requestHeading }),
    ).toBeInTheDocument();
    const email = screen.getByLabelText(copy.emailLabel);
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("name", "email");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(email).toBeRequired();
    expect(
      screen.getByRole("button", { name: copy.requestSubmit }),
    ).toHaveAttribute("type", "submit");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("links back to sign-in", async () => {
    await renderPage();

    expect(
      screen.getByRole("link", { name: copy.backToSignIn }),
    ).toHaveAttribute("href", "/sign-in");
  });

  it("announces sent as news that promises nothing about the address", async () => {
    await renderPage({ notice: "sent" });

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(copy.requestSent);
    expect(status).toHaveTextContent(/if that address belongs to an account/i);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    ["invalid", copy.requestInvalid],
    ["rate-limited", copy.requestRateLimited],
    ["failed", copy.requestFailed],
    ["link-invalid", copy.linkInvalid],
  ])("announces %s as an alert", async (notice, text) => {
    await renderPage({ notice });

    expect(screen.getByRole("alert")).toHaveTextContent(text);
    // The form is still there, so a person can try again at once.
    expect(screen.getByLabelText(copy.emailLabel)).toBeInTheDocument();
  });

  it("ignores a notice it does not recognise", async () => {
    await renderPage({ notice: "<script>alert(1)</script>" });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
