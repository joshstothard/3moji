import { render, screen, within } from "@testing-library/react";
import type { ViewerSummary } from "@template/core";

import en from "../../../../../packages/shared/messages/en.json";

/**
 * The account page, and the deletion it offers
 * ([#195](https://github.com/joshstothard/3moji/issues/195)).
 *
 * ADR-0004 decision 5 says Release is account deletion and that the interface
 * must say so plainly, and its consequences raise the bar on confirmation
 * copy. So what these tests pin is the copy a person reads before deleting,
 * and the confirmation field they cannot submit without. The action enforces
 * the confirmation itself (`account-delete-action.test.ts`); the page only
 * asks for it.
 */
const copy = en.AccountPage;
const ICE = "\u{1F9CA}\u{1F9CA}\u{1F9CA}";
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";

let summary: ViewerSummary = { state: "signed-out" };
jest.mock("../../lib/viewer", () => ({
  readViewerSummary: () => Promise.resolve(summary),
}));

jest.mock("../../components/account-delete-action", () => ({
  deleteAccountAction: jest.fn(),
}));

/**
 * `jest.setup.ts` mocks `redirect` as a bare `jest.fn()`, which returns. Real
 * Next.js throws, and the throw is what stops a signed-out visitor at the
 * guard instead of rendering the form below it.
 */
const REDIRECT = "NEXT_REDIRECT";
const redirect = jest.fn((_url: string): never => {
  throw new Error(REDIRECT);
});
jest.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));

import AccountPage, { dynamic } from "./page";

type Query = Record<string, string | string[] | undefined>;

async function renderPage(query: Query = {}): Promise<void> {
  render(await AccountPage({ searchParams: Promise.resolve(query) }));
}

beforeEach(() => {
  summary = { state: "owner", key: ICE, encoded: ENCODED };
  redirect.mockClear();
});

describe("the account page", () => {
  it("sends a signed-out visitor to sign in, and renders nothing", async () => {
    summary = { state: "signed-out" };

    await expect(
      AccountPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow(REDIRECT);
    expect(redirect).toHaveBeenCalledWith("/sign-in");
  });

  it("names the Handle the owner is signed in as", async () => {
    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: copy.heading }),
    ).toBeInTheDocument();
    expect(screen.getByText(ICE)).toBeInTheDocument();
  });

  it("says plainly that the Handle is given up, the Profile and Links are deleted, and it cannot be undone", async () => {
    await renderPage();

    const section = screen.getByRole("region", { name: copy.deleteHeading });
    const consequences = within(section).getAllByRole("listitem");
    expect(consequences.map((item) => item.textContent)).toEqual([
      copy.consequenceHandle,
      copy.consequenceProfile,
      copy.consequenceFinal,
    ]);
  });

  it("asks for the confirmation word before the delete button, as a required field", async () => {
    await renderPage();

    const field = screen.getByRole("textbox", {
      name: `${copy.confirmLabel} ${copy.confirmWord}`,
    });
    expect(field).toBeRequired();
    expect(field).toHaveAttribute("name", "confirmation");
    expect(field).toHaveValue("");

    const submit = screen.getByRole("button", { name: copy.submit });
    expect(submit).toHaveAttribute("type", "submit");
    expect(submit.closest("form")).toBe(field.closest("form"));
  });

  it("offers the same deletion to a signed-in Account whose Handle could not be read, without naming one", async () => {
    summary = { state: "signed-in" };

    await renderPage();

    expect(screen.queryByText(ICE)).toBeNull();
    expect(
      screen.getByRole("button", { name: copy.submit }),
    ).toBeInTheDocument();
  });

  it.each([
    ["confirm", copy.errorConfirm],
    ["failed", copy.errorFailed],
  ])("announces ?error=%s as an alert", async (error, message) => {
    await renderPage({ error });

    expect(screen.getByRole("alert")).toHaveTextContent(message);
  });

  it("ignores an error it does not know, because a query string is public input", async () => {
    await renderPage({ error: "<script>" });

    expect(screen.queryByRole("alert")).toBeNull();
  });

  /*
   * Found by `next build`, not by any test that renders: without this the page
   * was prerendered as static (`○ /account`). `readViewer` swallows the error
   * a session read throws at build time, and the signed-out redirect happens
   * before `searchParams` is read, so nothing marked the page dynamic — and
   * every visitor would be served the redirect to sign-in that was baked in.
   * `next dev` renders every request, so E2E cannot see this either.
   */
  it("is rendered per request, never prerendered, because it reads the session", () => {
    expect(dynamic).toBe("force-dynamic");
  });
});
