import type { ReactElement } from "react";
import { act, render, screen } from "@testing-library/react";
import type { Profile, ProfileState } from "@template/core";
import type { AvailabilityState } from "../../components/availability-state";
import type { ClaimFormState } from "../../components/claim-action";
import en from "../../../../../packages/shared/messages/en.json";

/**
 * The report link on a Handle page
 * ([#197](https://github.com/joshstothard/3moji/issues/197)).
 *
 * Its own file rather than a block in `page.test.tsx`, for one reason: this
 * suite mocks `next/headers` and `next/headers`' cookies to prove the link
 * reads neither, and a hoisted module mock would change what every other
 * suite in that file renders against. The route's collaborators are faked
 * exactly as `page.test.tsx` fakes them — `jest.mock` factories are hoisted per
 * file, which is why the block is repeated rather than imported. How the link
 * itself is built, and every injection case, is `lib/report-link.test.ts`'s.
 */
const copy = en.HandlePage;

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
const ALIAS = "ice-cube.ice-cube.ice-cube";
/** A placeholder on the IANA-reserved `example.com`; never a real mailbox. */
const ADDRESS = "reports@example.com";

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
jest.mock("@template/core", () => ({
  canonicalise: (segment: string) => canonicalise(segment),
  resolveAlias: (segment: string) => resolveAlias(segment),
  spokenHandle: () => "three ice cubes",
  canonicalAliasOf: () => ALIAS,
}));

jest.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
  permanentRedirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));

/**
 * The per-request reads a page would have to make to tell one visitor from
 * another. Each records its call and answers a signed-in visitor, so a link
 * that did read them would both be caught by the call count and render
 * differently.
 */
const headers = jest.fn(() =>
  Promise.resolve(new Headers({ cookie: "better-auth.session_token=owner" })),
);
interface StubCookie {
  readonly name: string;
  readonly value: string;
}
const cookies = jest.fn(() =>
  Promise.resolve({
    get: (): StubCookie | undefined => ({ name: "session", value: "owner" }),
  }),
);
jest.mock("next/headers", () => ({
  headers: () => headers(),
  cookies: () => cookies(),
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
  ],
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
};

/** The whole href the page must render for 🧊🧊🧊. */
const EXPECTED_HREF = `mailto:${ADDRESS}?subject=${encodeURIComponent(
  copy.reportSubject.replace("{path}", `/${ENCODED}`),
)}`;

function visit(handle: string): Promise<ReactElement> {
  return HandlePage({ params: Promise.resolve({ handle }) });
}

function reportLink(): HTMLElement | null {
  return screen.queryByRole("link", { name: copy.report });
}

const savedAddress = process.env.REPORT_CONTACT_EMAIL;
afterAll(() => {
  if (savedAddress === undefined) {
    Reflect.deleteProperty(process.env, "REPORT_CONTACT_EMAIL");
  } else {
    process.env.REPORT_CONTACT_EMAIL = savedAddress;
  }
});

describe("the report link on a Handle page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.REPORT_CONTACT_EMAIL = ADDRESS;
    canonicalise.mockReturnValue(resolved);
    resolveAlias.mockReturnValue({ ok: false, reason: "not-an-alias" });
    readAvailability.mockResolvedValue("claimed");
    readProfile.mockResolvedValue({ state: "profile", profile: PROFILE });
    readDisplayNames.mockResolvedValue(new Map());
  });

  it("is offered on a claimed Profile, mailing the configured address about its canonical path", async () => {
    render(await visit(ENCODED));

    expect(reportLink()).toHaveAttribute("href", EXPECTED_HREF);
  });

  it("names the canonical emoji path, not the alias, when the Profile is reached at its word alias", async () => {
    canonicalise.mockReturnValue({ ok: false, reason: "unknown-codepoint" });
    resolveAlias.mockReturnValue({
      ok: true,
      candidates: [
        {
          key: `${ICE}${ICE}${ICE}`,
          encoded: ENCODED,
          emoji: [{ emoji: ICE }, { emoji: ICE }, { emoji: ICE }],
        },
      ],
    });

    render(await visit(ALIAS));

    expect(reportLink()).toHaveAttribute("href", EXPECTED_HREF);
  });

  it("is offered on a claimed Handle whose owner has edited nothing, since the Handle itself can be the problem", async () => {
    readProfile.mockResolvedValue({ state: "unedited" });

    render(await visit(ENCODED));

    expect(reportLink()).toHaveAttribute("href", EXPECTED_HREF);
  });

  it("is not rendered at all when REPORT_CONTACT_EMAIL is unset", async () => {
    Reflect.deleteProperty(process.env, "REPORT_CONTACT_EMAIL");

    render(await visit(ENCODED));

    expect(screen.getByText("Zoe Frost")).toBeInTheDocument();
    expect(reportLink()).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("mailto:");
  });

  it("is not rendered when the variable would inject a mailto header", async () => {
    process.env.REPORT_CONTACT_EMAIL = `${ADDRESS}?bcc=attacker@example.net\r\nCc: x@example.net`;

    render(await visit(ENCODED));

    expect(screen.getByText("Zoe Frost")).toBeInTheDocument();
    expect(reportLink()).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("attacker");
  });

  it.each([
    ["held", "held", { state: "none" }],
    ["reserved", "not-claimable", { state: "none" }],
    ["unknown", "unknown", { state: "none" }],
    [
      "claimed Handle whose Profile could not be read",
      "claimed",
      { state: "none" },
    ],
  ] as const)(
    "is not offered for a %s",
    async (_name, state: AvailabilityState, profile: ProfileState) => {
      readAvailability.mockResolvedValue(state);
      readProfile.mockResolvedValue(profile);

      render(await visit(ENCODED));

      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
      expect(reportLink()).not.toBeInTheDocument();
    },
  );

  it("is not offered for an unclaimed Handle", async () => {
    readAvailability.mockResolvedValue("available");

    await act(async () => {
      render(await visit(ENCODED));
      await Promise.resolve();
    });

    expect(reportLink()).not.toBeInTheDocument();
  });

  it("does not vary the Profile by viewer: rendering it reads no request headers and no cookies", async () => {
    const first = render(await visit(ENCODED));
    const signedInHtml = first.container.innerHTML;
    first.unmount();

    headers.mockImplementation(() => Promise.resolve(new Headers()));
    cookies.mockImplementation(() =>
      Promise.resolve({ get: (): StubCookie | undefined => undefined }),
    );
    const second = render(await visit(ENCODED));

    expect(reportLink()).toHaveAttribute("href", EXPECTED_HREF);
    expect(headers).not.toHaveBeenCalled();
    expect(cookies).not.toHaveBeenCalled();
    expect(second.container.innerHTML).toBe(signedInHtml);
  });
});
