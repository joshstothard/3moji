import { render, screen } from "@testing-library/react";

import AnonymousHeldPage from "./page";

jest.mock("../../../components/resend-action", () => ({
  requestNewVerificationLink: jest.fn(),
}));

const renderPage = async (
  query: Record<string, string | string[] | undefined> = {},
) => render(await AnonymousHeldPage({ searchParams: Promise.resolve(query) }));

describe("the hold screen with no Handle named", () => {
  it("names no Handle, because naming one would be a guess", async () => {
    await renderPage({ reason: "link-unknown" });

    expect(screen.queryByRole("img")).toBeNull();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /could not read that link/i,
      }),
    ).toBeInTheDocument();
  });

  it("still offers a new link, because they know their own address", async () => {
    await renderPage({ reason: "link-unknown" });

    expect(
      screen.getByRole("button", { name: /send a new link/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/the email address you signed up with/i),
    ).toBeInTheDocument();
  });

  it("serves the unverified sign-in case too", async () => {
    await renderPage({ reason: "unverified" });

    expect(
      screen.getByRole("heading", { level: 1, name: /confirm your email/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/still held for you/i)).toBeInTheDocument();
  });

  it("shows the resend answer when one came back", async () => {
    await renderPage({ reason: "link-unknown", notice: "sent" });

    expect(screen.getByRole("status")).toHaveTextContent(
      /a new link is on its way/i,
    );
  });
});
