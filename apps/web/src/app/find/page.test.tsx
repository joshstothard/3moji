import { render, screen } from "@testing-library/react";

import en from "../../../../../packages/shared/messages/en.json";

/**
 * The target of the "Find a Handle" form (#200).
 *
 * `@template/core` cannot be `require`d under this suite, so the lookup is
 * faked here and its behaviour is `find-handle.test.ts`'s to prove; this suite
 * proves which answer each result becomes. `redirect` throws, as the real one
 * does, so nothing after it can render.
 */
type StubLookup =
  { readonly found: true; readonly alias: string } | { readonly found: false };

const findHandleAlias = jest.fn((_input: string): StubLookup => ({
  found: false,
}));
jest.mock("@template/core", () => ({
  findHandleAlias: (input: string) => findHandleAlias(input),
}));

const redirect = jest.fn((url: string): never => {
  throw new Error(`NEXT_REDIRECT;${url}`);
});
jest.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));

import FindPage, { metadata } from "./page";

const copy = en.FindPage;
const lookupCopy = en.HandleLookup;

async function renderPage(
  query: Record<string, string | string[] | undefined>,
): Promise<void> {
  render(await FindPage({ searchParams: Promise.resolve(query) }));
}

beforeEach(() => {
  jest.clearAllMocks();
  findHandleAlias.mockImplementation(() => ({ found: false }));
});

describe("the find page", () => {
  it("sends typed words that name a Handle to its alias path", async () => {
    findHandleAlias.mockImplementation(() => ({
      found: true,
      alias: "ice-cube.ice-cube.ice-cube",
    }));

    await expect(
      renderPage({ q: "ice cube ice cube ice cube" }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(findHandleAlias).toHaveBeenCalledWith("ice cube ice cube ice cube");
    expect(redirect).toHaveBeenCalledWith("/ice-cube.ice-cube.ice-cube");
  });

  it("says no Handle was found, and offers the lookup again with the words tried", async () => {
    await renderPage({ q: "three wibbles" });

    expect(redirect).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { level: 1, name: copy.notFoundHeading }),
    ).toBeInTheDocument();
    expect(screen.getByText(copy.notFound)).toBeInTheDocument();
    expect(
      screen.getByRole("searchbox", { name: lookupCopy.label }),
    ).toHaveValue("three wibbles");
  });

  it("reads only the first q when a query string repeats it", async () => {
    await renderPage({ q: ["wibble wobble wubble", "ice cube"] });

    expect(findHandleAlias).toHaveBeenCalledWith("wibble wobble wubble");
  });

  /**
   * #254. The home page no longer carries the lookup: the header search does,
   * and without JavaScript a phone's header links here. So a bare `/find` is
   * the lookup itself, empty, rather than a redirect to a page without one.
   */
  it.each([{}, { q: "" }, { q: "   " }])(
    "offers the lookup, empty, to a visitor with nothing typed (%p)",
    async (query) => {
      await renderPage(query);

      expect(redirect).not.toHaveBeenCalled();
      expect(findHandleAlias).not.toHaveBeenCalled();
      expect(
        screen.getByRole("heading", { level: 1, name: copy.title }),
      ).toBeInTheDocument();
      expect(screen.queryByText(copy.notFound)).not.toBeInTheDocument();
      expect(
        screen.getByRole("searchbox", { name: lookupCopy.label }),
      ).toHaveValue("");
    },
  );

  it("asks not to be indexed, because its content is whatever was typed", () => {
    expect(metadata.title).toBe(copy.title);
    expect(metadata.robots).toEqual({ index: false });
  });
});
