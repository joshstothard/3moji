import { renderToStaticMarkup } from "react-dom/server";

// next/font/google runs a build-time font loader that cannot execute under Jest.
// Each loader answers with the class that defines its CSS variable, which is
// what the root layout has to put on `<html>` (#251).
jest.mock("next/font/google", () => ({
  Inter: () => ({ className: "font-inter", variable: "font-inter-variable" }),
  Bricolage_Grotesque: () => ({
    className: "font-bricolage",
    variable: "font-display-variable",
  }),
  Geist: () => ({ className: "font-geist", variable: "font-sans-variable" }),
  Geist_Mono: () => ({
    className: "font-geist-mono",
    variable: "font-mono-variable",
  }),
}));

// The navbar's signed-in indicator reads the current path to know when to ask
// who is looking again (#193), and the header search (#254) reads it and the
// router. The real components render here, so the test below covers the whole
// shell, both islands included.
jest.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: jest.fn() }),
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

/**
 * The sign-out server action (#194), which the navbar's `<noscript>` and the
 * indicator render as a form. Its module reaches `lib/services` and so
 * better-auth, which is ESM-only here; the shell only renders the form and
 * never calls it, so the counts of `headers()` and `cookies()` below still
 * cover everything the shell does to render.
 */
jest.mock("../components/sign-out-action", () => ({
  signOutFormAction: (): Promise<void> => Promise.resolve(),
}));

import { redactAnalyticsEvent } from "../lib/analytics-redaction";
import {
  renderedAnalyticsProps,
  resetRenderedAnalyticsProps,
} from "../test-support/analytics-mock";
import RootLayout, { dynamic, metadata } from "./layout";

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

  /**
   * #251. The brand's three typefaces are self-hosted by `next/font` and reach
   * the page as CSS variables, which the `@theme` block in `globals.css` reads.
   * They are declared on `<html>`, so every element, the body's own font
   * included, resolves them. Inter is gone.
   */
  it("puts the brand's display, body and mono font variables on <html>, and no Inter", () => {
    const html = /<html[^>]*class="([^"]*)"/.exec(shell())?.[1] ?? "";
    const classes = html.split(/\s+/);

    expect(classes).toEqual(
      expect.arrayContaining([
        "font-display-variable",
        "font-sans-variable",
        "font-mono-variable",
      ]),
    );
    expect(shell()).not.toMatch(/font-inter/);
  });

  it("titles the document with the product name", () => {
    expect(metadata.title).toBe("3moji");
  });

  it("declares no preview card or base URL for every page to inherit (#204)", () => {
    // Root layout metadata is merged into every page, Profiles included: a
    // card here would become a Profile's wherever its own metadata omits one.
    expect(metadata).not.toHaveProperty("openGraph");
    expect(metadata).not.toHaveProperty("twitter");
    expect(metadata).not.toHaveProperty("metadataBase");
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

  /**
   * #205, option 1. The Content Security Policy's nonce exists only at request
   * time, and a prerendered page carries none, so its scripts would be refused
   * and it would never hydrate. The layout renders every page per request, and
   * does it by segment config rather than by reading the request, so the test
   * above still holds.
   */
  it("renders every page per request, so each carries its request's CSP nonce", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  /**
   * PR #238. `/reset-password/<token>` holds a live reset token in its path,
   * and Vercel Web Analytics records the URL of every page view. The shell
   * must render analytics only with the redaction attached.
   */
  it("renders Vercel Web Analytics with the URL redaction attached", () => {
    resetRenderedAnalyticsProps();

    shell();

    const rendered = renderedAnalyticsProps();
    expect(rendered).toHaveLength(1);
    expect(rendered[0]?.beforeSend).toBe(redactAnalyticsEvent);
  });
});
