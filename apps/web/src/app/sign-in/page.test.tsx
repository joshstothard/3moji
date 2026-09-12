import { render, screen } from "@testing-library/react";

import SignInPage from "./page";

jest.mock("../../components/sign-in-action", () => ({
  signInFormAction: jest.fn(),
}));

const renderPage = async (
  query: Record<string, string | string[] | undefined> = {},
) => render(await SignInPage({ searchParams: Promise.resolve(query) }));

describe("the sign-in page", () => {
  it("is a labelled email and password form a keyboard can complete", async () => {
    // WCAG AA: every control has an accessible name, from a real associated
    // label rather than a placeholder.
    await renderPage();

    expect(screen.getByLabelText(/email address/i)).toHaveAttribute(
      "type",
      "email",
    );
    expect(screen.getByLabelText(/password/i)).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByRole("button", { name: /sign in/i })).toHaveAttribute(
      "type",
      "submit",
    );
  });

  it("offers the browser the right autofill hints", async () => {
    await renderPage();

    expect(screen.getByLabelText(/email address/i)).toHaveAttribute(
      "autocomplete",
      "email",
    );
    expect(screen.getByLabelText(/password/i)).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
  });

  it("shows nothing alarming before anything has been tried", async () => {
    await renderPage();

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("announces a refusal without saying which half was wrong", async () => {
    await renderPage({ error: "invalid" });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/do not match an account/i);
    // Saying "no such address" would answer a question nobody should be able
    // to ask this endpoint.
    expect(alert).not.toHaveTextContent(/no account|not registered/i);
  });

  it("announces an outage as an outage", async () => {
    await renderPage({ error: "failed" });

    expect(screen.getByRole("alert")).toHaveTextContent(
      /try again in a moment/i,
    );
  });

  it("ignores an error value it does not recognise", async () => {
    // A query string is public input and this one lands in copy a person reads.
    await renderPage({ error: "<script>alert(1)</script>" });

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
