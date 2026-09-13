import type { ReactElement } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { Profile, ProfileState } from "@template/core";
import type { AvailabilityState } from "../../components/availability-state";
import en from "../../../../../packages/shared/messages/en.json";

const copy = en.HandlePage;
/**
 * The builder's own namespace. An unclaimed Handle renders the builder, so the
 * wording a visitor reads below the heading is the builder's — including the
 * live availability line, which is why "This Handle is available." no longer
 * belongs to this page at all.
 */
const builderCopy = en.HandleBuilder;

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

/**
 * What the page reads off an alias resolution. Same reasoning as `StubResult`:
 * a candidate is the three fields the route uses, and the real shape is
 * asserted by `packages/core/src/handle/alias.test.ts`.
 *
 * It deliberately has **no `isCanonical`**, because an alias candidate does not
 * have one — a 308 answer about an emoji segment is meaningless for an alias,
 * and a page that must not redirect must not be handed one.
 */
interface StubCandidate {
  readonly key: string;
  readonly encoded: string;
  readonly emoji: readonly StubEmoji[];
}
type StubAlias =
  | { readonly ok: true; readonly candidates: readonly StubCandidate[] }
  | { readonly ok: false; readonly reason: string };

const canonicalise = jest.fn((_segment: string): StubResult => resolved);
const resolveAlias = jest.fn((_segment: string): StubAlias => ({
  ok: false,
  reason: "not-an-alias",
}));
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
  resolveAlias: (segment: string) => resolveAlias(segment),
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

/**
 * The Profile read, faked for the reason the availability read is: this page is
 * a transport adapter, so what belongs here is which answer takes which branch.
 * That the read itself refuses to fetch a Profile for anything but a claimed
 * Handle is asserted in `lib/profile.test.ts`, against the real
 * `profileStateOf`.
 *
 * It defaults to `none` — a real state, and the one a claimed Handle whose
 * Profile read failed comes back with — so every assertion written before this
 * mock existed keeps the meaning it was written with.
 */
const readProfile = jest.fn(
  (_segment: string, _state: AvailabilityState): Promise<ProfileState> =>
    Promise.resolve({ state: "none" }),
);
jest.mock("../../lib/profile", () => ({
  readProfile: (segment: string, state: AvailabilityState) =>
    readProfile(segment, state),
}));

/**
 * A Profile with something in every field.
 *
 * The Link titles are deliberately **not** in alphabetical order while their
 * positions ascend, so a stray `.sort()` between the repository and the page
 * would show up as a DOM order that disagrees with `position`.
 */
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

function profileWith(fields: Partial<Profile>): ProfileState {
  return { state: "profile", profile: { ...PROFILE, ...fields } };
}

/**
 * The builder's availability read is a **server action** — `"use server"`, and
 * `lib/services.ts` behind it — so importing the real module would drag the
 * server runtime into a jsdom suite. It is faked here for the same reason the
 * page's own read is, and for the same reason the builder takes it as a prop:
 * it is the one collaborator that leaves the browser.
 *
 * The builder itself is **not** faked. It is the component under test as much
 * as the route is: the acceptance criteria are about what a visitor can do at
 * `/🧊🧊🧊`, and a stubbed builder would assert nothing about focus, the
 * category tabs, or the live availability line.
 */
const checkAvailability = jest.fn(
  (_segment: string): Promise<AvailabilityState> =>
    Promise.resolve("available"),
);
jest.mock("../../components/availability-action", () => ({
  checkAvailability: (segment: string) => checkAvailability(segment),
}));

import HandlePage from "./page";

function visit(handle: string): Promise<ReactElement> {
  return HandlePage({ params: Promise.resolve({ handle }) });
}

describe("the Handle route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    canonicalise.mockReturnValue(resolved);
    // The default for this block: nothing here is an alias, so a rejected
    // segment still 404s exactly as it did before ADR-0008 added the second
    // grammar. The alias path has its own block below.
    resolveAlias.mockReturnValue({ ok: false, reason: "not-an-alias" });
    spokenHandle.mockReturnValue(SPOKEN);
    // Claimed, not available, because available is now the one answer that
    // renders the whole builder. A test about redirects or accessible names
    // should not be dragging 307 emoji buttons into the document to get there;
    // the unclaimed state has its own describe block below.
    readAvailability.mockResolvedValue("claimed");
    checkAvailability.mockResolvedValue("available");
    readProfile.mockResolvedValue({ state: "none" });
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
    expect(readProfile).not.toHaveBeenCalled();
  });

  it("308s a resolvable but non-canonical spelling to the canonical path", async () => {
    canonicalise.mockReturnValue({ ...resolved, isCanonical: false });

    await expect(visit(`${ENCODED}%EF%B8%8F`)).rejects.toThrow(REDIRECT);
    expect(permanentRedirect).toHaveBeenCalledWith(`/${ENCODED}`);
    expect(notFound).not.toHaveBeenCalled();
    expect(readAvailability).not.toHaveBeenCalled();
    expect(readProfile).not.toHaveBeenCalled();
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
    expect(screen.getByText(copy.stateClaimed)).toBeInTheDocument();
    expect(notFound).not.toHaveBeenCalled();
    expect(permanentRedirect).not.toHaveBeenCalled();
  });

  it("asks about the canonical segment, the same one the builder asks about", async () => {
    await visit(ENCODED);

    expect(readAvailability).toHaveBeenCalledWith(ENCODED);
  });

  it.each([
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

      expect(
        screen.queryByText(builderCopy.stateAvailable),
      ).not.toBeInTheDocument();
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

  it.each(["held", "claimed", "not-claimable", "unknown"] as const)(
    "offers a %s Handle no builder and no controls at all",
    async (state) => {
      // The load-bearing assertion of #105, and the reason it is counted in
      // buttons rather than in copy: the builder *is* buttons — three slots and
      // 307 emoji — so zero of them is proof the builder is absent however its
      // wording changes.
      //
      // Two of these four are defects if they ever render it. **Reserved** can
      // never be claimed, so inviting a claim would be
      // [#68](https://github.com/joshstothard/3moji/issues/68) in a new form,
      // and **unknown** means the read failed — it cannot know the Handle is
      // free, so it must not offer it.
      readAvailability.mockResolvedValue(state);

      render(await visit(ENCODED));

      expect(screen.queryAllByRole("button")).toHaveLength(0);
      expect(screen.queryAllByRole("link")).toHaveLength(0);
      expect(
        screen.queryByRole("heading", { name: builderCopy.builderHeading }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(copy.unclaimed)).not.toBeInTheDocument();
    },
  );
});

/**
 * The unclaimed state, which is the whole of
 * [#105](https://github.com/joshstothard/3moji/issues/105).
 *
 * Somebody who typed a Handle into the address bar has already told us what
 * they want, so the answer is not a line saying they may have it — it is the
 * builder, holding exactly those three emoji, with the claim still to make.
 * `docs/architecture/data-model.md` § Profile has said so since Phase 2.
 *
 * The builder here is the **real** one, imported by the route. That is the
 * point of the reuse: if it were forked, or stubbed in this suite, the focus
 * and keyboard assertions below would be measuring a copy nobody ships.
 */
describe("an unclaimed Handle", () => {
  const ICE_NAME = "ice cube";

  function filledSlot(position: number, name: string): HTMLElement {
    return screen.getByRole("button", {
      name: builderCopy.slotFilled
        .replace("{position}", String(position))
        .replace("{name}", name),
    });
  }

  function emptySlot(position: number): HTMLElement {
    return screen.getByRole("button", {
      name: builderCopy.slotEmpty.replace("{position}", String(position)),
    });
  }

  function categoryTabs(): HTMLElement {
    return screen.getByRole("group", {
      name: builderCopy.pickerCategoriesLabel,
    });
  }

  /**
   * Render the page and wait for the builder's own read to land.
   *
   * The builder checks availability on mount — it opens with three slots
   * already full, so there is something to ask about immediately — and settling
   * that before asserting is what keeps a state update from arriving outside
   * `act`. It also means every assertion below is made against the page a
   * visitor actually ends up looking at.
   */
  async function renderUnclaimed(
    settled: string = builderCopy.stateAvailable,
  ): Promise<UserEvent> {
    const user = userEvent.setup();
    render(await visit(ENCODED));
    await screen.findByText(settled);
    return user;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    canonicalise.mockReturnValue(resolved);
    spokenHandle.mockReturnValue(SPOKEN);
    readAvailability.mockResolvedValue("available");
    checkAvailability.mockResolvedValue("available");
    readProfile.mockResolvedValue({ state: "none" });
  });

  it("renders the builder with those three emoji already picked", async () => {
    await renderUnclaimed();

    expect(
      screen.getByRole("heading", { name: builderCopy.builderHeading }),
    ).toBeInTheDocument();
    expect(filledSlot(1, ICE_NAME)).toBeInTheDocument();
    expect(filledSlot(2, ICE_NAME)).toBeInTheDocument();
    expect(filledSlot(3, ICE_NAME)).toBeInTheDocument();
  });

  it("invites the visitor to claim it rather than stating a fact and stopping", async () => {
    await renderUnclaimed();

    expect(screen.getByText(copy.unclaimed)).toBeInTheDocument();
  });

  it("asks the builder's own read about the same segment the route asked about", async () => {
    // Both surfaces go through `lib/availability.ts`, so the live line under
    // the slots agrees with the answer that put the builder on the page.
    render(await visit(ENCODED));

    await waitFor(() => {
      expect(checkAvailability).toHaveBeenCalledWith(ENCODED);
    });
    expect(
      await screen.findByText(builderCopy.stateAvailable),
    ).toBeInTheDocument();
  });

  it("behaves exactly as on the home page when a slot is changed", async () => {
    checkAvailability.mockResolvedValue("claimed");
    const user = await renderUnclaimed(builderCopy.stateClaimed);

    await user.click(filledSlot(3, ICE_NAME));

    expect(emptySlot(3)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "pizza" }));
    expect(filledSlot(3, "pizza")).toBeInTheDocument();
    expect(
      await screen.findByText(builderCopy.stateClaimed),
    ).toBeInTheDocument();
  });

  it("keeps focus on the very same slot control when the slot is cleared", async () => {
    // #78's regression, re-asserted from this route: the prototype swapped the
    // control when a slot changed, which unmounted the focused node and dropped
    // focus to <body>. Asserting on node identity is what catches it.
    const user = await renderUnclaimed();

    const before = filledSlot(1, ICE_NAME);
    before.focus();
    await user.keyboard("{Enter}");

    expect(document.activeElement).toBe(before);
    expect(before).toBe(emptySlot(1));
    expect(document.body).not.toHaveFocus();
  });

  it("keeps focus on the slot when it is filled again", async () => {
    const user = await renderUnclaimed();

    await user.click(filledSlot(2, ICE_NAME));
    const picked = screen.getByRole("button", { name: "pizza" });
    picked.focus();
    await user.keyboard("{Enter}");

    expect(picked).toHaveFocus();
    expect(filledSlot(2, "pizza")).toBeInTheDocument();
  });

  it("offers the keyboard-reachable category tabs, as the home page does", async () => {
    // #79's category tabs, from this route. They are toggle buttons rather
    // than a tablist on purpose (system-overview.md § The home page).
    const user = await renderUnclaimed();

    const tab = within(categoryTabs()).getByRole("button", {
      name: "Animals & Nature",
    });
    tab.focus();
    expect(tab).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(tab).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "gorilla" })).toBeInTheDocument();
  });
});

/**
 * The word alias, which is
 * [#108](https://github.com/joshstothard/3moji/issues/108) and
 * [ADR-0008](../../../../../docs/adr/0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md).
 *
 * `3moji.me/🧊🧊🧊` cannot be shared — an autolinker truncates the path at the
 * first non-ASCII byte — so the same Handle answers at
 * `3moji.me/ice-cube.ice-cube.ice-cube` too. The resolver itself is the
 * domain's and is tested there; what belongs here is the dispatch: which
 * grammar runs first, and what the **count** of claimed matches makes the route
 * do (decision 4).
 */
describe("a word alias", () => {
  const RED = "\u{1F34E}";
  const GREEN = "\u{1F34F}";
  const RED_KEY = `${RED}${RED}${RED}`;
  const GREEN_KEY = `${GREEN}${GREEN}${GREEN}`;
  const RED_ENCODED = encodeURIComponent(RED_KEY);
  const GREEN_ENCODED = encodeURIComponent(GREEN_KEY);

  const iceCandidate: StubCandidate = {
    key: `${ICE}${ICE}${ICE}`,
    encoded: ENCODED,
    emoji: [{ emoji: ICE }, { emoji: ICE }, { emoji: ICE }],
  };
  const redCandidate: StubCandidate = {
    key: RED_KEY,
    encoded: RED_ENCODED,
    emoji: [{ emoji: RED }, { emoji: RED }, { emoji: RED }],
  };
  const greenCandidate: StubCandidate = {
    key: GREEN_KEY,
    encoded: GREEN_ENCODED,
    emoji: [{ emoji: GREEN }, { emoji: GREEN }, { emoji: GREEN }],
  };

  /**
   * Read from `document.head` rather than from the render container on
   * purpose: React hoists a `<link>` rendered inside a component into the
   * document head, and a canonical URL left in the body is not a canonical URL
   * at all. Asserting the hoist is asserting the behaviour.
   */
  function canonicalLink(): HTMLLinkElement | null {
    return document.head.querySelector('link[rel="canonical"]');
  }

  beforeEach(() => {
    jest.clearAllMocks();
    // An ASCII segment is never an emoji Handle, so this is what the emoji
    // grammar says about every alias below.
    canonicalise.mockReturnValue({ ok: false, reason: "unknown-codepoint" });
    resolveAlias.mockReturnValue({ ok: true, candidates: [iceCandidate] });
    spokenHandle.mockReturnValue(SPOKEN);
    readAvailability.mockResolvedValue("claimed");
    checkAvailability.mockResolvedValue("available");
    // Pinned rather than left to the factory default: `jest.clearAllMocks()`
    // does not clear a `mockResolvedValue` set by another suite, so the
    // assertions below that expect the honest line would otherwise depend on
    // which `describe` ran first.
    readProfile.mockResolvedValue({ state: "none" });
  });

  it("tries the emoji grammar first, and never reaches the alias when it wins", async () => {
    // ADR-0008 decision 7: the emoji path is untouched. It is not enough that
    // it still works — it must still run *first*, and on its own.
    canonicalise.mockReturnValue(resolved);

    render(await visit(ENCODED));

    expect(resolveAlias).not.toHaveBeenCalled();
    expect(canonicalLink()).toBeNull();
  });

  it("leaves the 308 to the emoji grammar", async () => {
    canonicalise.mockReturnValue({ ...resolved, isCanonical: false });

    await expect(visit(`${ENCODED}%EF%B8%8F`)).rejects.toThrow(REDIRECT);
    expect(resolveAlias).not.toHaveBeenCalled();
  });

  it("hands the resolver the segment exactly as Next.js gave it", async () => {
    await visit("ice-cube.ice-cube.ice-cube");

    expect(resolveAlias).toHaveBeenCalledWith("ice-cube.ice-cube.ice-cube");
  });

  it.each([
    ["is not three dot-separated terms", "not-an-alias"],
    ["holds a word we do not know", "unknown-term"],
  ])("404s a segment that %s", async (_name, reason) => {
    resolveAlias.mockReturnValue({ ok: false, reason });

    await expect(visit("whatever.at.all")).rejects.toThrow(NOT_FOUND);
    expect(notFound).toHaveBeenCalledTimes(1);
    expect(permanentRedirect).not.toHaveBeenCalled();
    expect(readAvailability).not.toHaveBeenCalled();
  });

  it("asks about the emoji path of every candidate", async () => {
    resolveAlias.mockReturnValue({
      ok: true,
      candidates: [redCandidate, greenCandidate],
    });

    await visit("apple.apple.apple");

    expect(readAvailability).toHaveBeenCalledWith(RED_ENCODED);
    expect(readAvailability).toHaveBeenCalledWith(GREEN_ENCODED);
  });

  it("renders the one claimed Profile in place, and never redirects to it", async () => {
    // The load-bearing assertion of ADR-0008. A 308 to the emoji path would
    // replace the shared ASCII link in the address bar with 45 characters of
    // percent-escapes, which is the entire defect the alias exists to avoid.
    render(await visit("ice-cube.ice-cube.ice-cube"));

    expect(permanentRedirect).not.toHaveBeenCalled();
    expect(notFound).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { level: 1, name: SPOKEN }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: SPOKEN })).toHaveTextContent(
      `${ICE}${ICE}${ICE}`,
    );
    expect(screen.getByText(copy.stateClaimed)).toBeInTheDocument();
  });

  it("renders the Profile behind the one claimed match, under the alias URL", async () => {
    // The composition with [#104](https://github.com/joshstothard/3moji/issues/104):
    // "exactly one claimed match renders that Profile in place" is only
    // literally true once the alias path takes the same second read the emoji
    // path takes — before that it rendered the honest "taken" line and no
    // Profile at all, for a Handle that has one.
    readProfile.mockResolvedValue({ state: "profile", profile: PROFILE });

    render(await visit("ice-cube.ice-cube.ice-cube"));

    expect(readProfile).toHaveBeenCalledWith(ENCODED, "claimed");
    expect(screen.getByText("Zoe Frost")).toBeInTheDocument();
    expect(screen.getByText("Cold takes only.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Zebra zine" }),
    ).toBeInTheDocument();
    // Still the alias URL: the Profile is rendered here, not redirected to.
    expect(permanentRedirect).not.toHaveBeenCalled();
    expect(canonicalLink()).toHaveAttribute("href", `/${ENCODED}`);
  });

  it("reads a Profile for the Handle it shows and for no other candidate", async () => {
    // The availability read costs one per candidate, and ADR-0008's worst
    // measured alias is 64 of them. The Profile read must not double that:
    // there is one page, so there is one Profile worth fetching.
    resolveAlias.mockReturnValue({
      ok: true,
      candidates: [redCandidate, greenCandidate],
    });
    readAvailability.mockImplementation((segment: string) =>
      Promise.resolve(segment === GREEN_ENCODED ? "claimed" : "available"),
    );
    readProfile.mockResolvedValue({ state: "unedited" });

    render(await visit("apple.apple.apple"));

    expect(readProfile).toHaveBeenCalledTimes(1);
    expect(readProfile).toHaveBeenCalledWith(GREEN_ENCODED, "claimed");
  });

  it("reads no Profile at all when the alias names no page to show", async () => {
    // Nothing is shown, so there is nothing to fetch a Profile for — and a
    // read issued anyway would be a Profile fetched for a Handle the visitor
    // is deliberately not being shown.
    resolveAlias.mockReturnValue({
      ok: true,
      candidates: [redCandidate, greenCandidate],
    });
    readAvailability.mockResolvedValue("claimed");

    render(await visit("apple.apple.apple"));

    expect(readProfile).not.toHaveBeenCalled();
    expect(screen.getByText(copy.aliasSeveral)).toBeInTheDocument();
  });

  it("points rel=canonical at the emoji path, never at the alias", async () => {
    // An alias is ambiguous by construction and so can never be canonical
    // (decision 5): one indexable URL per Profile, and it is the emoji one.
    render(await visit("ice-cube.ice-cube.ice-cube"));

    expect(canonicalLink()).toHaveAttribute("href", `/${ENCODED}`);
  });

  it("shows the single claimed Handle out of several candidates", async () => {
    // `apple` names both 🍎 and 🍏, so the alias names eight Handles. Exactly
    // one of them being claimed is what makes a page answerable.
    resolveAlias.mockReturnValue({
      ok: true,
      candidates: [redCandidate, greenCandidate],
    });
    readAvailability.mockImplementation((segment: string) =>
      Promise.resolve(segment === GREEN_ENCODED ? "claimed" : "available"),
    );

    render(await visit("apple.apple.apple"));

    expect(screen.getByRole("img", { name: SPOKEN })).toHaveTextContent(
      GREEN_KEY,
    );
    expect(canonicalLink()).toHaveAttribute("href", `/${GREEN_ENCODED}`);
    expect(permanentRedirect).not.toHaveBeenCalled();
  });

  it("renders the claim call to action when nothing is claimed", async () => {
    readAvailability.mockResolvedValue("available");

    render(await visit("ice-cube.ice-cube.ice-cube"));
    await screen.findByText(builderCopy.stateAvailable);

    expect(screen.getByText(copy.unclaimed)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: builderCopy.builderHeading }),
    ).toBeInTheDocument();
  });

  it.each([
    ["several are claimed", "claimed"],
    ["none is claimed", "available"],
  ] as const)("says so and shows no listing when %s", async (_name, state) => {
    // The listing is [#109](https://github.com/joshstothard/3moji/issues/109),
    // and improvising one here would answer its privacy and ranking questions
    // by accident. Counted in controls and in emoji rather than in copy: an
    // accidental listing is buttons and Handles however it is worded.
    resolveAlias.mockReturnValue({
      ok: true,
      candidates: [redCandidate, greenCandidate],
    });
    readAvailability.mockResolvedValue(state);

    render(await visit("apple.apple.apple"));

    expect(screen.getByText(copy.aliasSeveral)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: copy.aliasSeveralHeading }),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(
      new RegExp(`${RED}|${GREEN}`, "u"),
    );
    expect(notFound).not.toHaveBeenCalled();
  });

  it("declares no canonical URL when it is showing no Handle", async () => {
    // There is no single emoji path to point at, and inventing one would be a
    // claim that this alias means that Handle.
    resolveAlias.mockReturnValue({
      ok: true,
      candidates: [redCandidate, greenCandidate],
    });
    readAvailability.mockResolvedValue("claimed");

    render(await visit("apple.apple.apple"));

    expect(canonicalLink()).toBeNull();
  });
});

/**
 * A claimed Handle with a Profile — the page the product exists to show
 * ([#104](https://github.com/joshstothard/3moji/issues/104)).
 */
describe("a claimed Handle with a Profile", () => {
  function renderProfile(
    state: ProfileState = { state: "profile", profile: PROFILE },
  ) {
    readProfile.mockResolvedValue(state);
    return visit(ENCODED);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    canonicalise.mockReturnValue(resolved);
    spokenHandle.mockReturnValue(SPOKEN);
    readAvailability.mockResolvedValue("claimed");
    checkAvailability.mockResolvedValue("available");
    readProfile.mockResolvedValue({ state: "profile", profile: PROFILE });
  });

  it("asks about the same segment the availability read asked about", async () => {
    await visit(ENCODED);

    expect(readProfile).toHaveBeenCalledWith(ENCODED, "claimed");
  });

  it("shows the display name and the bio", async () => {
    render(await renderProfile());

    expect(screen.getByText("Zoe Frost")).toBeInTheDocument();
    expect(screen.getByText("Cold takes only.")).toBeInTheDocument();
  });

  it("shows the Links in the owner's order, not in any order of its own", async () => {
    render(await renderProfile());

    const titles = screen.getAllByRole("link").map((link) => link.textContent);

    // Ascending by `position`, which is deliberately not alphabetical: a
    // `.sort()` anywhere on the way here would read Alpha, Middle, Zebra.
    expect(titles).toEqual(["Zebra zine", "Alpha notes", "Middle thing"]);
  });

  it("points each Link at the owner's URL", async () => {
    render(await renderProfile());

    expect(screen.getByRole("link", { name: "Zebra zine" })).toHaveAttribute(
      "href",
      "https://zine.example/z",
    );
  });

  it("opens every Link safely", async () => {
    render(await renderProfile());

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it.each([
    ["plain script URL", "javascript:alert(1)"],
    ["mixed case", "JavaScript:alert(1)"],
    ["leading whitespace", " javascript:alert(1)"],
    ["embedded tab", "java\tscript:alert(1)"],
    ["data URL", "data:text/html,<script>alert(1)</script>"],
    ["scheme that merely starts with http", "httpfoo://evil.example"],
    ["hyphenated near-miss", "https-evil:alert(1)"],
  ])("refuses to render a %s as a link", async (_name, url) => {
    // Defence in depth. `validateProfile` refuses these at the write
    // (`data-model.md` § Profile pins the same shapes), and this is the second
    // layer: a row written before that guard existed, or by any other path,
    // must not reach a visitor's browser as a working script URL. The title is
    // still the owner's content, so it stays — as text.
    render(
      await renderProfile(
        profileWith({
          links: [{ id: "x", title: "Tap me", url, position: 0 }],
        }),
      ),
    );

    expect(
      screen.queryByRole("link", { name: "Tap me" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Tap me")).toBeInTheDocument();
    expect(document.body.querySelector("[href]")).toBeNull();
  });

  it("keeps the emoji as the one first-level heading, named by its Spoken Name", async () => {
    // The display name is the owner's, but the Handle is what the page is
    // about and what a screen reader should announce first — and it must still
    // announce as "three ice cubes" rather than as three code points.
    render(await renderProfile());

    expect(
      screen.getByRole("heading", { level: 1, name: SPOKEN }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("img", { name: SPOKEN })).toHaveTextContent(
      `${ICE}${ICE}${ICE}`,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Zoe Frost" }),
    ).toBeInTheDocument();
  });

  it("says how to say it out loud", async () => {
    render(await renderProfile());

    expect(
      screen.getByText(copy.spoken.replace("{spoken}", SPOKEN)),
    ).toBeInTheDocument();
  });

  it("omits the spoken line rather than saying it aloud as undefined", async () => {
    spokenHandle.mockReturnValue(undefined);

    render(await renderProfile());

    expect(document.body.textContent).not.toMatch(/undefined/);
  });

  it("renders a Profile with nothing but Links without empty fields", async () => {
    render(await renderProfile(profileWith({ displayName: null, bio: null })));

    expect(screen.queryAllByRole("heading", { level: 2 })).toHaveLength(0);
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("offers no builder, because the Handle is somebody else's", async () => {
    render(await renderProfile());

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(
      screen.queryByRole("heading", { name: builderCopy.builderHeading }),
    ).not.toBeInTheDocument();
  });

  it("is reachable by keyboard, with visible focus", async () => {
    const user = userEvent.setup();
    render(await renderProfile());

    await user.tab();

    const first = screen.getByRole("link", { name: "Zebra zine" });
    expect(first).toHaveFocus();
    // jsdom computes no styles, so the focus indicator is asserted as the
    // utility that produces it. #78's regression is asserted on node identity
    // where that is possible; here it is not.
    expect(first.className).toMatch(/focus-visible:outline/);
  });
});

/**
 * Claimed, and the owner has never edited anything. A **named** state, which is
 * the whole reason `profileStateOf` exists — not a Profile whose fields all
 * happen to be blank.
 */
describe("a claimed but unedited Handle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    canonicalise.mockReturnValue(resolved);
    spokenHandle.mockReturnValue(SPOKEN);
    readAvailability.mockResolvedValue("claimed");
    checkAvailability.mockResolvedValue("available");
    readProfile.mockResolvedValue({ state: "unedited" });
  });

  it("renders large, with its Spoken Name", async () => {
    render(await visit(ENCODED));

    expect(
      screen.getByRole("heading", { level: 1, name: SPOKEN }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(copy.spoken.replace("{spoken}", SPOKEN)),
    ).toBeInTheDocument();
    expect(screen.getByText(copy.unedited)).toBeInTheDocument();
  });

  it("is not an empty Profile", async () => {
    // The distinction the acceptance criterion turns on: no name slot, no bio
    // slot and no Link list standing empty waiting to be filled.
    render(await visit(ENCODED));

    expect(screen.queryAllByRole("heading", { level: 2 })).toHaveLength(0);
    expect(screen.queryAllByRole("list")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("omits the spoken line rather than saying it aloud as undefined", async () => {
    spokenHandle.mockReturnValue(undefined);

    render(await visit(ENCODED));

    expect(document.body.textContent).not.toMatch(/undefined/);
  });

  it("offers no builder", async () => {
    render(await visit(ENCODED));

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

/**
 * The regression the acceptance criteria call for by name.
 *
 * [#80](https://github.com/joshstothard/3moji/issues/80) made leaking the
 * holder or the expiry impossible *in the type*: `AvailabilityState` is a bare
 * string union, so the `Reservation` and the hold expiry never leave
 * `packages/core`. A Profile is the first thing this page renders that is not a
 * state name, and a future debug view is exactly how that seal would break.
 *
 * So these are **forced hostile**: the Profile read is made to answer with a
 * fully-populated Profile for states that can never legitimately have one, and
 * the page must still show none of it. A test that merely omitted to supply a
 * Profile would pass against a page that renders whatever it is given.
 */
describe("the sealed states", () => {
  const LEAK: ProfileState = {
    state: "profile",
    profile: {
      displayName: "holder@example.com",
      bio: "on hold until 3 September, 14 hours left",
      links: [
        {
          id: "leak",
          title: "Who is holding this",
          url: "https://leak.example/holder",
          position: 0,
        },
      ],
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    canonicalise.mockReturnValue(resolved);
    spokenHandle.mockReturnValue(SPOKEN);
    checkAvailability.mockResolvedValue("available");
    readProfile.mockResolvedValue(LEAK);
  });

  it.each([
    ["held", copy.stateHeld],
    ["not-claimable", copy.stateNotClaimable],
    ["unknown", copy.stateUnknown],
  ] as const)(
    "renders nothing of a Profile handed to it for a %s Handle",
    async (state, line) => {
      readAvailability.mockResolvedValue(state);

      render(await visit(ENCODED));

      expect(screen.getByText(line)).toBeInTheDocument();
      expect(screen.queryAllByRole("link")).toHaveLength(0);
      expect(document.body.textContent).not.toMatch(/holder@example\.com/);
      expect(document.body.textContent).not.toMatch(/Who is holding this/);
    },
  );

  it("still reveals neither the holder nor the expiry of a held Handle", async () => {
    // ADR-0004, re-asserted with a Profile pushed at the page rather than
    // withheld from it: a countdown is an information leak and an invitation
    // to wait.
    readAvailability.mockResolvedValue("held");

    render(await visit(ENCODED));

    expect(screen.getByText(copy.stateHeld)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d/);
    expect(document.body.textContent).not.toMatch(
      /until|expire|minute|hour|day|left|remaining|@/i,
    );
  });

  it("renders nothing of a Profile handed to it for an unclaimed Handle", async () => {
    // `profileStateOf` guards this at the domain and `lib/profile.ts` never
    // fetches for it, but a lazily-expired hold leaves a real Profile row
    // behind, so the page is the last place it could surface.
    readAvailability.mockResolvedValue("available");

    render(await visit(ENCODED));

    expect(document.body.textContent).not.toMatch(/holder@example\.com/);
    expect(
      screen.queryByRole("link", { name: "Who is holding this" }),
    ).not.toBeInTheDocument();
  });
});
