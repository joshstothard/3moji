import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import type { AvailabilityState } from "../../components/availability-state";
import en from "../../../../../packages/shared/messages/en.json";

const copy = en.HandlePage;

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

/**
 * The one shared availability read, faked here for the reason
 * `@template/core` is: this page is a transport adapter, so what belongs here
 * is which answer takes which branch. How the read itself degrades when the
 * database is unreachable is asserted in `lib/availability.test.ts`.
 */
const readAvailability = jest.fn(
  (_segment: string): Promise<AvailabilityState> =>
    Promise.resolve("available"),
);
jest.mock("../../lib/availability", () => ({
  readAvailability: (segment: string) => readAvailability(segment),
}));

import HandlePage from "./page";

function visit(handle: string): Promise<ReactElement> {
  return HandlePage({ params: Promise.resolve({ handle }) });
}

describe("the Handle route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    canonicalise.mockReturnValue(resolved);
    spokenHandle.mockReturnValue(SPOKEN);
    readAvailability.mockResolvedValue("available");
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
    // The availability read must sit *after* both early exits. `notFound` and
    // `permanentRedirect` signal by throwing, so a read wrapped around them —
    // or a try/catch reaching over them — swallows the 404 and the 308 and
    // renders an availability line for junk instead.
    expect(readAvailability).not.toHaveBeenCalled();
  });

  it("308s a resolvable but non-canonical spelling to the canonical path", async () => {
    canonicalise.mockReturnValue({ ...resolved, isCanonical: false });

    await expect(visit(`${ENCODED}%EF%B8%8F`)).rejects.toThrow(REDIRECT);
    expect(permanentRedirect).toHaveBeenCalledWith(`/${ENCODED}`);
    expect(notFound).not.toHaveBeenCalled();
    expect(readAvailability).not.toHaveBeenCalled();
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

  it("renders a canonical, resolvable Handle large, with its Spoken Name", async () => {
    render(await visit(ENCODED));

    expect(
      screen.getByRole("heading", { level: 1, name: SPOKEN }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: SPOKEN })).toHaveTextContent(
      `${ICE}${ICE}${ICE}`,
    );
    expect(screen.getByText(copy.stateAvailable)).toBeInTheDocument();
    expect(notFound).not.toHaveBeenCalled();
    expect(permanentRedirect).not.toHaveBeenCalled();
  });

  it("asks about the canonical segment, the same one the builder asks about", async () => {
    await visit(ENCODED);

    expect(readAvailability).toHaveBeenCalledWith(ENCODED);
  });

  it.each([
    ["available", copy.stateAvailable],
    ["held", copy.stateHeld],
    ["claimed", copy.stateClaimed],
    ["not-claimable", copy.stateNotClaimable],
    ["unknown", copy.stateUnknown],
  ] as const)("tells a visitor the %s answer", async (state, text) => {
    readAvailability.mockResolvedValue(state);

    render(await visit(ENCODED));

    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it.each(["claimed", "held", "not-claimable", "unknown"] as const)(
    "never says a %s Handle is available",
    async (state) => {
      // Issue #68 in one assertion: the placeholder said "available" for every
      // Handle that resolved, including a platform-reserved one.
      readAvailability.mockResolvedValue(state);

      render(await visit(ENCODED));

      expect(screen.queryByText(copy.stateAvailable)).not.toBeInTheDocument();
    },
  );

  it("resolves a Reserved Handle rather than pretending it does not exist", async () => {
    // A Reserved Handle is a real, well-formed Handle that nobody may own, so
    // 404 would be a lie of the opposite kind.
    readAvailability.mockResolvedValue("not-claimable");

    render(await visit(ENCODED));

    expect(notFound).not.toHaveBeenCalled();
    expect(permanentRedirect).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { level: 1, name: SPOKEN }),
    ).toBeInTheDocument();
    expect(screen.getByText(copy.stateNotClaimable)).toBeInTheDocument();
  });

  it("never says why a Handle is reserved", async () => {
    // Naming the block is a hint to go looking for the list. The page cannot
    // leak it even carelessly: the read answers with a state name, so the
    // `Reservation` — which does carry the reason — never crosses into the UI.
    readAvailability.mockResolvedValue("not-claimable");

    render(await visit(ENCODED));

    expect(document.body.textContent).not.toMatch(
      /brand|platform|blocked|threat|harassment|apple|snapchat/i,
    );
  });

  it("reveals neither who holds a held Handle nor when the hold expires", async () => {
    // ADR-0004: a countdown is an information leak and an invitation to wait.
    readAvailability.mockResolvedValue("held");

    render(await visit(ENCODED));

    expect(screen.getByText(copy.stateHeld)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d/);
    expect(document.body.textContent).not.toMatch(
      /until|expire|minute|hour|day|left|remaining|@/i,
    );
  });

  it("answers unknown, not available, when the domain cannot place the segment", async () => {
    // The route canonicalised the segment itself, so the read cannot honestly
    // come back "not-a-handle" about it. If it ever does, the answer shown is
    // the honest one rather than a guess.
    readAvailability.mockResolvedValue("not-a-handle");

    render(await visit(ENCODED));

    expect(screen.getByText(copy.stateUnknown)).toBeInTheDocument();
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
