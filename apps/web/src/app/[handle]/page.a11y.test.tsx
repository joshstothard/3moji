import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import type { Profile, ProfileState } from "@template/core";
import type { AvailabilityState } from "../../components/availability-state";
import type { ClaimFormState } from "../../components/claim-action";
import { checkAccessibility } from "../../test-support/axe";

/**
 * The claimed Profile and the alias listing, checked by axe for WCAG 2 A and AA
 * ([#152](https://github.com/joshstothard/3moji/issues/152)).
 *
 * **Both are reached through the route, because neither is exported.**
 * `ProfilePage`, `UneditedHandle` and `AliasListing` are private to `page.tsx`,
 * and exporting them to test them would be a source change made for a test's
 * convenience. So this suite fakes the route's collaborators exactly as
 * `page.test.tsx` does — the same stubs, the same Profile — and renders the
 * route. `jest.mock` factories are hoisted per test file, which is why that
 * block is repeated here rather than imported.
 *
 * The container is still a component: the root layout, its `<html lang>`, the
 * navbar and the footer are not rendered, so landmarks and the document title
 * are left to the rendered-page check in
 * [#153](https://github.com/joshstothard/3moji/issues/153).
 */
interface StubEmoji {
  readonly emoji: string;
}
interface StubCandidate {
  readonly key: string;
  readonly encoded: string;
  readonly emoji: readonly StubEmoji[];
}
type StubResult =
  | { readonly ok: false; readonly reason: string }
  | (StubCandidate & { readonly ok: true; readonly isCanonical: boolean });
type StubAlias =
  | { readonly ok: true; readonly candidates: readonly StubCandidate[] }
  | { readonly ok: false; readonly reason: string };

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
const resolveAlias = jest.fn((_segment: string): StubAlias => ({
  ok: false,
  reason: "not-an-alias",
}));
const spokenHandle = jest.fn(
  (_codepoints: readonly string[]): string | undefined => SPOKEN,
);
jest.mock("@template/core", () => ({
  canonicalise: (segment: string) => canonicalise(segment),
  resolveAlias: (segment: string) => resolveAlias(segment),
  spokenHandle: (codepoints: readonly string[]) => spokenHandle(codepoints),
  canonicalAliasOf: () => "ice-cube.ice-cube.ice-cube",
}));

// The share control's origin (#160), so the claimed Profile below renders it.
const savedOrigin = process.env.BETTER_AUTH_URL;
process.env.BETTER_AUTH_URL = "http://localhost:3000";
afterAll(() => {
  if (savedOrigin === undefined) {
    Reflect.deleteProperty(process.env, "BETTER_AUTH_URL");
  } else {
    process.env.BETTER_AUTH_URL = savedOrigin;
  }
});

jest.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
  permanentRedirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));

const readAvailability = jest.fn(
  (_segment: string): Promise<AvailabilityState> => Promise.resolve("claimed"),
);
jest.mock("../../lib/availability", () => ({
  readAvailability: (segment: string) => readAvailability(segment),
}));

const readProfile = jest.fn(
  (_segment: string, _state: AvailabilityState): Promise<ProfileState> =>
    Promise.resolve({ state: "none" }),
);
const readDisplayNames = jest.fn(
  (_segments: readonly string[]): Promise<ReadonlyMap<string, string>> =>
    Promise.resolve(new Map()),
);
jest.mock("../../lib/profile", () => ({
  readProfile: (segment: string, state: AvailabilityState) =>
    readProfile(segment, state),
  readDisplayNames: (segments: readonly string[]) => readDisplayNames(segments),
}));

jest.mock("../../components/availability-action", () => ({
  checkAvailability: () => Promise.resolve("available"),
}));
jest.mock("../../components/claim-action", () => ({
  claimFormAction: (_previous: ClaimFormState, _formData: FormData) =>
    new Promise<ClaimFormState>(() => undefined),
}));

import HandlePage from "./page";

/** The Profile `page.test.tsx` renders: something in every field. */
const PROFILE: Profile = {
  displayName: "Zoe Frost",
  bio: "Cold takes only.",
  links: [
    {
      id: "l1",
      title: "Zebra zine",
      url: "https://zine.example/z",
      position: 0,
    },
    {
      id: "l2",
      title: "Alpha notes",
      url: "https://notes.example/a",
      position: 1,
    },
    {
      id: "l3",
      title: "Middle thing",
      url: "http://mid.example/m",
      position: 2,
    },
  ],
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
};

function visit(handle: string): Promise<ReactElement> {
  return HandlePage({ params: Promise.resolve({ handle }) });
}

function candidateOf(emoji: string): StubCandidate {
  const key = `${emoji}${emoji}${emoji}`;
  return {
    key,
    encoded: encodeURIComponent(key),
    emoji: [{ emoji }, { emoji }, { emoji }],
  };
}

describe("the Handle page's Profile and listing, checked by axe", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    canonicalise.mockReturnValue(resolved);
    resolveAlias.mockReturnValue({ ok: false, reason: "not-an-alias" });
    spokenHandle.mockReturnValue(SPOKEN);
    readAvailability.mockResolvedValue("claimed");
    readProfile.mockResolvedValue({ state: "none" });
    readDisplayNames.mockResolvedValue(new Map());
  });

  it("reports no violations for a claimed Profile, share control included", async () => {
    readProfile.mockResolvedValue({ state: "profile", profile: PROFILE });
    const { container } = render(await visit(ENCODED));

    const report = await checkAccessibility(container);

    expect(report.violations).toEqual([]);
    expect(report.incomplete).toEqual([]);
    expect(report.passed).toEqual(
      expect.arrayContaining([
        "button-name",
        "link-name",
        "list",
        "listitem",
        "role-img-alt",
      ]),
    );
  });

  it("reports no violations for a claimed Handle whose owner has edited nothing", async () => {
    readProfile.mockResolvedValue({ state: "unedited" });
    const { container } = render(await visit(ENCODED));

    const report = await checkAccessibility(container);

    expect(report.violations).toEqual([]);
    expect(report.incomplete).toEqual([]);
    expect(report.passed).toEqual(expect.arrayContaining(["role-img-alt"]));
  });

  it("reports no violations for the listing of an alias's claimed Handles", async () => {
    const RED = "\u{1F34E}";
    const GREEN = "\u{1F34F}";
    const red = candidateOf(RED);
    const green = candidateOf(GREEN);
    canonicalise.mockReturnValue({ ok: false, reason: "unknown-codepoint" });
    resolveAlias.mockReturnValue({ ok: true, candidates: [red, green] });
    spokenHandle.mockImplementation((codepoints: readonly string[]) =>
      codepoints.at(0) === RED ? "three red apples" : "three green apples",
    );
    readDisplayNames.mockResolvedValue(
      new Map([
        [red.encoded, "Ada Rose"],
        [green.encoded, "Bruno Green"],
      ]),
    );
    const { container } = render(await visit("apple.apple.apple"));

    const report = await checkAccessibility(container);

    expect(report.violations).toEqual([]);
    expect(report.incomplete).toEqual([]);
    expect(report.passed).toEqual(
      expect.arrayContaining(["link-name", "list", "listitem", "role-img-alt"]),
    );
  });
});
