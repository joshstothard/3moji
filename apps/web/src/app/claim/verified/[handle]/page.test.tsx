import { render, screen } from "@testing-library/react";

/**
 * `jest.setup.ts` mocks `notFound` as a bare `jest.fn()`, which returns
 * `undefined`. Real Next.js throws, and the throw is what makes the branch an
 * early exit — without it, execution falls out of the `notFound()` branch and
 * renders anyway, so every assertion would be measuring the wrong thing. This
 * sentinel restores the real control flow.
 */
const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";
const notFound = jest.fn((): never => {
  throw new Error(NOT_FOUND);
});
jest.mock("next/navigation", () => ({
  notFound: () => notFound(),
}));

import VerifiedPage from "./page";

const ICE = "\u{1F9CA}\u{1F9CA}\u{1F9CA}";
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";

const renderPage = async (handle: string) =>
  render(await VerifiedPage({ params: Promise.resolve({ handle }) }));

describe("the verified page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("says the Handle is theirs, and says it out loud", async () => {
    await renderPage(ENCODED);

    expect(
      screen.getByRole("heading", { level: 1, name: /it is yours/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "three ice cubes" }),
    ).toHaveTextContent(ICE);
    expect(screen.getByText(/say it: three ice cubes/i)).toBeInTheDocument();
  });

  it("links to the Handle's own URL, percent-encoded", async () => {
    // Until the Profile lands (Phase 4) this is a link rather than a redirect:
    // `/[handle]` reads no database and says "This Handle is available" for
    // every Handle, so sending a new owner straight there would tell them the
    // Handle they just claimed is free.
    await renderPage(ENCODED);

    expect(
      screen.getByRole("link", { name: /go to your handle/i }),
    ).toHaveAttribute("href", `/${ENCODED}`);
  });

  it("needs no session, because the second click of a link issues none", async () => {
    // Better Auth answers an already-verified address with no cookie, so a page
    // that required a session would break for the commonest double-click.
    await renderPage(ENCODED);

    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("404s a segment that is not a Handle", async () => {
    await expect(renderPage("nonsense")).rejects.toThrow(NOT_FOUND);
    expect(notFound).toHaveBeenCalledTimes(1);
  });
});
