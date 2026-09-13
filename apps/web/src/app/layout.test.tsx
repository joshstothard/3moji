import { renderToStaticMarkup } from "react-dom/server";

// next/font/google runs a build-time font loader that cannot execute under Jest.
jest.mock("next/font/google", () => ({
  Inter: () => ({ className: "font-inter" }),
}));

// The navbar's signed-in indicator reads the current path to know when to ask
// who is looking again (#193). The real component renders here, so the test
// below covers the whole shell, island included.
jest.mock("next/navigation", () => ({
  usePathname: () => "/",
  redirect: jest.fn(),
  notFound: jest.fn(),
}));

/**
 * The two request APIs a session is read through. Counted rather than
 * forbidden, so a shell that read either shows up as a call here (#193).
 */
const headers = jest.fn(() => Promise.resolve(new Headers()));
const cookies = jest.fn(() => Promise.resolve({ get: () => undefined }));
jest.mock("next/headers", () => ({
  headers: () => headers(),
  cookies: () => cookies(),
}));

import RootLayout, { metadata } from "./layout";

const shell = () =>
  renderToStaticMarkup(
    <RootLayout>
      <p>child content</p>
    </RootLayout>,
  );

describe("RootLayout", () => {
  it("wraps its children in the app shell", () => {
    expect(shell()).toContain("child content");
  });

  it("renders the product name from the navbar", () => {
    expect(shell()).toContain("3moji");
  });

  it("titles the document with the product name", () => {
    expect(metadata.title).toBe("3moji");
  });

  it("carries no OKR branding in its metadata", () => {
    expect(JSON.stringify(metadata)).not.toMatch(/okr|objective|key result/i);
  });

  /**
   * #193. The shell wraps every page, the public Profile included, so a shell
   * that read the session would make every page's response differ by visitor.
   * The signed-in indicator asks `GET /api/viewer` from the browser instead.
   */
  it("reads no request headers and no cookies to render, signed-in indicator included", () => {
    const markup = shell();

    expect(headers).not.toHaveBeenCalled();
    expect(cookies).not.toHaveBeenCalled();
    // The island is in the tree, and renders nobody's links on the server.
    expect(markup).toContain('href="/sign-in"');
    expect(markup).not.toMatch(/%F0%9F|\/edit"/);
  });
});
