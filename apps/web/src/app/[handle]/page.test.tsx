import { render, screen } from "@testing-library/react";

/**
 * What the page reads off a canonicalisation result. Spelled out here rather
 * than imported from `@template/core` so a stub needs three fields instead of
 * three whole Emoji Set entries; the real shape is asserted by the real
 * function's own suite in `packages/core`.
 */
interface StubEmoji {
  readonly emoji: string;
}
type StubResult =
  | { readonly ok: false; readonly reason: string }
  | {
      readonly ok: true;
      readonly key: string;
      readonly encoded: string;
      readonly isCanonical: boolean;
      readonly emoji: readonly StubEmoji[];
    };

const ICE = "\u{1F9CA}";
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";
const SPOKEN = "three ice cubes";

const resolved: StubResult = {
  ok: true,
  key: `${ICE}${ICE}${ICE}`,
  encoded: ENCODED,
  isCanonical: true,
  emoji: [{ emoji: ICE }, { emoji: ICE }, { emoji: ICE }],
};

const canonicalise = jest.fn((_segment: string): StubResult => resolved);
const spokenHandle = jest.fn(
  (_codepoints: readonly string[]): string | undefined => SPOKEN,
);

// packages/core pulls in ESM-only dependencies that cannot be `require`d under
// this suite, which is why `lib/services.test.ts` mocks it too. It is also the
// right boundary: this page is a transport adapter, so what belongs here is
// which branch each canonicalisation result takes. The real function meets the
// real route in `apps/web/e2e/handle-url.spec.ts`.
jest.mock("@template/core", () => ({
  canonicalise: (segment: string) => canonicalise(segment),
  spokenHandle: (codepoints: readonly string[]) => spokenHandle(codepoints),
}));

/**
 * `jest.setup.ts` mocks these as bare `jest.fn()`, which return `undefined`.
 * Real Next.js throws, and the throw is what makes each branch an early exit —
 * without it execution falls out of the `notFound()` branch, into the redirect
 * check, and renders the placeholder anyway, so every assertion below would be
 * measuring the wrong thing. These sentinels restore the real control flow.
 */
const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";
const REDIRECT = "NEXT_REDIRECT";
const notFound = jest.fn((): never => {
  throw new Error(NOT_FOUND);
});
const permanentRedirect = jest.fn((_url: string): never => {
  throw new Error(REDIRECT);
});
jest.mock("next/navigation", () => ({
  notFound: () => notFound(),
  permanentRedirect: (url: string) => permanentRedirect(url),
}));

import HandlePage from "./page";

function visit(handle: string): Promise<React.ReactElement> {
  return HandlePage({ params: Promise.resolve({ handle }) });
}

describe("the Handle route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    canonicalise.mockReturnValue(resolved);
    spokenHandle.mockReturnValue(SPOKEN);
  });

  it("hands the segment to the domain exactly as Next.js gave it, still encoded", async () => {
    await visit(ENCODED);

    expect(canonicalise).toHaveBeenCalledWith(ENCODED);
  });

  it.each([
    "malformed-encoding",
    "wrong-length",
    "unknown-codepoint",
    "unreleased-category",
  ])("404s a segment rejected as %s", async (reason) => {
    canonicalise.mockReturnValue({ ok: false, reason });

    await expect(visit("whatever")).rejects.toThrow(NOT_FOUND);
    expect(notFound).toHaveBeenCalledTimes(1);
    expect(permanentRedirect).not.toHaveBeenCalled();
  });

  it("308s a resolvable but non-canonical spelling to the canonical path", async () => {
    canonicalise.mockReturnValue({ ...resolved, isCanonical: false });

    await expect(visit(`${ENCODED}%EF%B8%8F`)).rejects.toThrow(REDIRECT);
    expect(permanentRedirect).toHaveBeenCalledWith(`/${ENCODED}`);
    expect(notFound).not.toHaveBeenCalled();
  });

  it("redirects to the percent-encoded path and never to raw emoji", async () => {
    canonicalise.mockReturnValue({ ...resolved, isCanonical: false });

    await expect(visit("anything")).rejects.toThrow(REDIRECT);

    // A raw emoji in a Location header throws ERR_INVALID_CHAR and serves a 500
    // (docs/reports/2026-09-11-emoji-urls.md), so the assertion is on the bytes:
    // ASCII only, and nothing but percent-escapes after the leading slash.
    const [target] = permanentRedirect.mock.calls[0] ?? [];
    expect(target).toMatch(/^\/(?:%[0-9A-F]{2})+$/);
  });

  it("renders the placeholder for a canonical, resolvable Handle", async () => {
    render(await visit(ENCODED));

    expect(
      screen.getByRole("heading", { level: 1, name: SPOKEN }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: SPOKEN })).toHaveTextContent(
      `${ICE}${ICE}${ICE}`,
    );
    expect(screen.getByText(/available/i)).toBeInTheDocument();
    expect(notFound).not.toHaveBeenCalled();
    expect(permanentRedirect).not.toHaveBeenCalled();
  });

  it("builds the accessible name from the Handle's code points", async () => {
    render(await visit(ENCODED));

    expect(spokenHandle).toHaveBeenCalledWith([ICE, ICE, ICE]);
  });

  it("labels the Handle with its key when there is no spoken form", async () => {
    spokenHandle.mockReturnValue(undefined);

    render(await visit(ENCODED));

    expect(
      screen.getByRole("heading", { level: 1, name: `${ICE}${ICE}${ICE}` }),
    ).toBeInTheDocument();
  });

  it("is a placeholder only: it offers no builder and no profile links", async () => {
    // The builder is Phase 3 and the Profile is Phase 4 (issue #53). A link
    // appearing here is the signal that this page has grown past its remit.
    render(await visit(ENCODED));

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
