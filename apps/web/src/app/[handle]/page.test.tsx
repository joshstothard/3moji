import type { ReactElement } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { Profile, ProfileState } from "@template/core";
import type { AvailabilityState } from "../../components/availability-state";
import type { ClaimFormState } from "../../components/claim-action";
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
/**
 * The canonical word alias, faked for the reason `spokenHandle` is: its real
 * answers come from the curated names and are asserted in
 * `packages/core/src/handle/alias.test.ts`. What belongs here is that the share
 * control on a Profile is built from it
 * ([#160](https://github.com/joshstothard/3moji/issues/160)).
 */
const ALIAS = "ice-cube.ice-cube.ice-cube";
const canonicalAliasOf = jest.fn(
  (_codepoints: readonly string[]): string | undefined => ALIAS,
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
  canonicalAliasOf: (codepoints: readonly string[]) =>
    canonicalAliasOf(codepoints),
}));

/**
 * The share link's origin is `BETTER_AUTH_URL`, read on the server by
 * `lib/share-link.ts`. Set here with a trailing slash, so a link built by
 * string concatenation would come out with a doubled `//`.
 */
const ORIGIN = "http://localhost:3000";
const SHARE_HREF = `${ORIGIN}/${ALIAS}`;
const savedOrigin = process.env.BETTER_AUTH_URL;
process.env.BETTER_AUTH_URL = `${ORIGIN}/`;
afterAll(() => {
  if (savedOrigin === undefined) {
    Reflect.deleteProperty(process.env, "BETTER_AUTH_URL");
  } else {
    process.env.BETTER_AUTH_URL = savedOrigin;
  }
});

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
/**
 * The listing's own read: every display name in **one** call, rather than a
 * `readProfile` per row. Faked here for the reason `readProfile` is — what
 * belongs on this page is the shape of the call, and the query behind it is
 * asserted in `lib/profile.test.ts`.
 *
 * It answers a map keyed on the **percent-encoded segment**, and an absent key
 * means "no display name to show" — which is one state covering both a Handle
 * whose owner has never edited anything and one whose `displayName` is still
 * `null`, so a row has one branch rather than three.
 */
const readDisplayNames = jest.fn(
  (_segments: readonly string[]): Promise<ReadonlyMap<string, string>> =>
    Promise.resolve(new Map()),
);
jest.mock("../../lib/profile", () => ({
  readProfile: (segment: string, state: AvailabilityState) =>
    readProfile(segment, state),
  readDisplayNames: (segments: readonly string[]) => readDisplayNames(segments),
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

/**
 * The claim is a server action too, faked for the same reason as the
 * availability read. It never settles, as an accepted Claim never does in a
 * browser: it redirects away. What the form does with each answer is
 * `claim-form.test.tsx`'s; what belongs here is that the route offers it.
 */
const claimFormAction = jest.fn(
  (_previous: ClaimFormState, _formData: FormData) =>
    new Promise<ClaimFormState>(() => undefined),
);
jest.mock("../../components/claim-action", () => ({
  claimFormAction: (previous: ClaimFormState, formData: FormData) =>
    claimFormAction(previous, formData),
}));

import HandlePage, { generateMetadata } from "./page";

function visit(handle: string): Promise<ReactElement> {
  return HandlePage({ params: Promise.resolve({ handle }) });
}

/**
 * The metadata Next.js would put in the head for `handle`
 * ([#161](https://github.com/joshstothard/3moji/issues/161)). The canonical URL
 * is emitted here and nowhere else: a second `<link rel="canonical">` rendered
 * by the page would be two canonicals, which is no canonical at all.
 */
function metadataOf(handle: string) {
  return generateMetadata({ params: Promise.resolve({ handle }) });
}

/**
 * Render a page whose builder asks about availability on mount, and let that
 * read land inside `act`.
 *
 * Since #115 the route hands the builder the answer it has just read, so the
 * availability line is on the page from the first render — which means waiting
 * for that line no longer waits for the builder's re-check. Its answer then
 * lands on whichever `await` comes next, outside both `waitFor` and `act`, and
 * React warns. Rendering inside an async `act` flushes it there instead, before
 * any assertion runs; settling afterwards is too late, because the answer may
 * already have landed during the wait.
 */
async function renderSettled(page: ReactElement): Promise<void> {
  await act(async () => {
    render(page);
    await Promise.resolve();
  });
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

  /**
   * #251. The brand shows a Handle as three tiles, one emoji in each. The
   * tiles sit inside the one `role="img"`, so the heading still announces the
   * Spoken Name once rather than three code points.
   */
  it("sets the Handle's emoji in three tiles inside the one named image", async () => {
    render(await visit(ENCODED));

    const image = screen.getByRole("img", { name: SPOKEN });
    const tiles = Array.from(image.children);
    expect(tiles.map((tile) => tile.textContent)).toEqual([ICE, ICE, ICE]);
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
      expect(document.querySelectorAll("form")).toHaveLength(0);
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
    await renderSettled(await visit(ENCODED));
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

  it("makes the call to action a real control that reaches the claim form", async () => {
    // #105 left it as copy because there was nowhere to link to (#115).
    await renderUnclaimed();

    const action = screen.getByRole("link", { name: copy.unclaimedAction });
    const target = action.getAttribute("href") ?? "";
    expect(target).toMatch(/^#./);

    const destination = document.getElementById(target.slice(1));
    expect(destination).not.toBeNull();
    expect(destination).toContainElement(
      screen.getByRole("form", { name: en.Claim.claimHeading }),
    );
  });

  it("offers the claim form for this Handle, with nothing else filled in", async () => {
    await renderUnclaimed();

    const form = screen.getByRole("form", { name: en.Claim.claimHeading });
    expect(
      form.querySelector<HTMLInputElement>('input[name="handle"]')?.value,
    ).toBe(ENCODED);
    expect(screen.getByLabelText(en.Claim.claimEmailLabel)).toHaveValue("");
    expect(screen.getByLabelText(en.Claim.claimPasswordLabel)).toHaveValue("");
  });

  it("has the claim form in place before the builder's own read has answered", async () => {
    // The route has just read "available"; the link must not point at nothing
    // while the builder asks the same question again.
    checkAvailability.mockReturnValue(new Promise(() => undefined));

    render(await visit(ENCODED));

    expect(
      screen.getByRole("form", { name: en.Claim.claimHeading }),
    ).toBeInTheDocument();
  });

  it("asks the builder's own read about the same segment the route asked about", async () => {
    // Both surfaces go through `lib/availability.ts`, so the live line under
    // the slots agrees with the answer that put the builder on the page.
    await renderSettled(await visit(ENCODED));

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
    readDisplayNames.mockResolvedValue(new Map());
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
    expect(
      (await metadataOf("ice-cube.ice-cube.ice-cube")).alternates?.canonical,
    ).toBe(`${ORIGIN}/${ENCODED}`);
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

  it("reads no Profile and no display names when nothing it names is claimed", async () => {
    // A claim listing shows Handles nobody has, so there is no Profile and no
    // owner to fetch — and a read issued anyway would be work done for rows
    // that can never show its answer.
    resolveAlias.mockReturnValue({
      ok: true,
      candidates: [redCandidate, greenCandidate],
    });
    readAvailability.mockResolvedValue("available");

    render(await visit("apple.apple.apple"));

    expect(readProfile).not.toHaveBeenCalled();
    expect(readDisplayNames).not.toHaveBeenCalled();
    expect(
      screen.getByRole("list", { name: copy.aliasClaimListingLabel }),
    ).toBeInTheDocument();
  });

  it("points rel=canonical at the emoji path, never at the alias", async () => {
    // An alias is ambiguous by construction and so can never be canonical
    // (decision 5): one indexable URL per Profile, and it is the emoji one.
    const metadata = await metadataOf("ice-cube.ice-cube.ice-cube");

    expect(metadata.alternates?.canonical).toBe(`${ORIGIN}/${ENCODED}`);
  });

  it("emits its canonical URL once, through the metadata, and not again from the page", async () => {
    render(await visit("ice-cube.ice-cube.ice-cube"));

    expect(canonicalLink()).toBeNull();
  });

  it("declares the emoji path as canonical whatever spelling the metadata is handed", async () => {
    // Observed against a production build: the emoji page answered 200 with
    // no canonical at all. The page decides the 308, so metadata for another
    // spelling is never sent; it must still name the one canonical path
    // rather than depend on which spelling Next.js handed it.
    canonicalise.mockReturnValue({ ...resolved, isCanonical: false });

    const metadata = await metadataOf(ENCODED);

    expect(metadata.alternates?.canonical).toBe(`${ORIGIN}/${ENCODED}`);
    expect(metadata.openGraph?.url).toBe(`${ORIGIN}/${ENCODED}`);
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
    expect((await metadataOf("apple.apple.apple")).alternates?.canonical).toBe(
      `${ORIGIN}/${GREEN_ENCODED}`,
    );
    expect(permanentRedirect).not.toHaveBeenCalled();
  });

  it("renders the claim call to action when nothing is claimed", async () => {
    readAvailability.mockResolvedValue("available");

    await renderSettled(await visit("ice-cube.ice-cube.ice-cube"));
    await screen.findByText(builderCopy.stateAvailable);

    expect(screen.getByText(copy.unclaimed)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: builderCopy.builderHeading }),
    ).toBeInTheDocument();
    // The same real control as on the emoji path (#115), and the form it
    // reaches claims the candidate's emoji segment — never the ASCII alias,
    // which is not a Handle and which the Claim would refuse.
    expect(
      screen.getByRole("link", { name: copy.unclaimedAction }),
    ).toBeInTheDocument();
    const form = screen.getByRole("form", { name: en.Claim.claimHeading });
    expect(
      form.querySelector<HTMLInputElement>('input[name="handle"]')?.value,
    ).toBe(iceCandidate.encoded);
  });

  it("declares no canonical URL when it is showing no Handle", async () => {
    // There is no single emoji path to point at, and inventing one would be a
    // claim that this alias means that Handle.
    resolveAlias.mockReturnValue({
      ok: true,
      candidates: [redCandidate, greenCandidate],
    });
    readAvailability.mockResolvedValue("available");

    const metadata = await metadataOf("apple.apple.apple");

    expect(metadata.alternates).toBeUndefined();
    expect(metadata.openGraph?.url).toBeUndefined();
  });
});

/**
 * The listing: an alias that names more than one **claimed** Handle
 * ([#109](https://github.com/joshstothard/3moji/issues/109), ADR-0008
 * decision 4).
 *
 * Roughly one alias in ten needs a disambiguating tap, so this is not an edge
 * case — it is the answer to 9.3% of three-term queries, and sending somebody
 * to the wrong Profile is worse than asking which they meant.
 *
 * Two things are asserted here that the other branches cannot be: that the
 * rows carry **emoji and a display name** (decision 6 — the words cannot tell
 * 🍎🍎🍎 from 🍏🍏🍏, and no unique username is introduced to help them), and
 * that the whole listing costs **one** display-name read rather than one per
 * row.
 */
describe("a listing of the claimed Handles an alias names", () => {
  const RED = "\u{1F34E}";
  const GREEN = "\u{1F34F}";
  const BLUE = "\u{1F7E6}";
  const RED_KEY = `${RED}${RED}${RED}`;
  const GREEN_KEY = `${GREEN}${GREEN}${GREEN}`;
  const BLUE_KEY = `${BLUE}${BLUE}${BLUE}`;
  const RED_ENCODED = encodeURIComponent(RED_KEY);
  const GREEN_ENCODED = encodeURIComponent(GREEN_KEY);
  const BLUE_ENCODED = encodeURIComponent(BLUE_KEY);
  const RED_SPOKEN = "three red apples";
  const GREEN_SPOKEN = "three green apples";

  function candidateOf(emoji: string): StubCandidate {
    const key = `${emoji}${emoji}${emoji}`;
    return {
      key,
      encoded: encodeURIComponent(key),
      emoji: [{ emoji }, { emoji }, { emoji }],
    };
  }

  const redCandidate = candidateOf(RED);
  const greenCandidate = candidateOf(GREEN);
  const blueCandidate = candidateOf(BLUE);

  function canonicalLink(): HTMLLinkElement | null {
    return document.head.querySelector('link[rel="canonical"]');
  }

  /** The listing, by its accessible name rather than by a class or a test id. */
  function listing(): HTMLElement {
    return screen.getByRole("list", { name: copy.aliasListingLabel });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    canonicalise.mockReturnValue({ ok: false, reason: "unknown-codepoint" });
    resolveAlias.mockReturnValue({
      ok: true,
      candidates: [redCandidate, greenCandidate],
    });
    // Distinct per Handle, because a listing whose rows all announce the same
    // name would pass an accessible-name assertion while telling a screen
    // reader user nothing about which row is which — the exact failure the
    // acceptance criteria name.
    spokenHandle.mockImplementation((codepoints: readonly string[]) =>
      codepoints.at(0) === RED ? RED_SPOKEN : GREEN_SPOKEN,
    );
    readAvailability.mockResolvedValue("claimed");
    checkAvailability.mockResolvedValue("available");
    // Pinned here rather than left to the factory defaults, for the reason the
    // alias suite above pins them: `jest.clearAllMocks()` does not clear a
    // `mockResolvedValue` another suite set.
    readProfile.mockResolvedValue({ state: "none" });
    readDisplayNames.mockResolvedValue(
      new Map([
        [RED_ENCODED, "Ada Rose"],
        [GREEN_ENCODED, "Bruno Green"],
      ]),
    );
  });

  it("renders one row per claimed match, in the resolver's order", async () => {
    // The order is the candidate set's, not a ranking. ADR-0008 leaves ranking
    // open, and sorting by name or by recency here would answer it by accident.
    render(await visit("apple.apple.apple"));

    const rows = within(listing()).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Ada Rose");
    expect(rows[1]).toHaveTextContent("Bruno Green");
  });

  it("shows each row's emoji and the owner's display name", async () => {
    // Decision 6: the display name is what disambiguates, and the emoji are
    // what actually distinguish these two Handles when the words cannot.
    render(await visit("apple.apple.apple"));

    expect(screen.getByRole("img", { name: RED_SPOKEN })).toHaveTextContent(
      RED_KEY,
    );
    expect(screen.getByRole("img", { name: GREEN_SPOKEN })).toHaveTextContent(
      GREEN_KEY,
    );
    expect(screen.getByText("Ada Rose")).toBeInTheDocument();
    expect(screen.getByText("Bruno Green")).toBeInTheDocument();
  });

  it("links each row to that Handle's own canonical emoji URL", async () => {
    render(await visit("apple.apple.apple"));

    const links = within(listing()).getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", `/${RED_ENCODED}`);
    expect(links[1]).toHaveAttribute("href", `/${GREEN_ENCODED}`);
  });

  it("names each row by its Spoken Name and its owner, not by a pile of pictographs", async () => {
    // Three unlabelled code points announce one at a time as "red apple red
    // apple red apple", which is what `role="img"` and the Spoken Name exist to
    // replace. The name is computed from the row's content rather than set with
    // `aria-label` on the anchor, so the owner's name is part of it.
    render(await visit("apple.apple.apple"));

    expect(
      screen.getByRole("link", { name: `${RED_SPOKEN} Ada Rose` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: `${GREEN_SPOKEN} Bruno Green` }),
    ).toBeInTheDocument();
  });

  it("falls back to the Handle itself when there is no way to say it", async () => {
    // `spokenHandle` answers `undefined` outside the curated set, and a row
    // named "undefined" is worse than a row named by its own emoji.
    spokenHandle.mockReturnValue(undefined);

    render(await visit("apple.apple.apple"));

    expect(screen.getByRole("img", { name: RED_KEY })).toBeInTheDocument();
  });

  it("is keyboard operable, one tab stop per row, with visible focus", async () => {
    // WCAG 2.1.1 and 2.4.7. A listing whose rows are not real links is a
    // listing a keyboard user cannot use at all.
    const user: UserEvent = userEvent.setup();
    render(await visit("apple.apple.apple"));

    const links = within(listing()).getAllByRole("link");
    await user.tab();
    expect(links[0]).toHaveFocus();
    await user.tab();
    expect(links[1]).toHaveFocus();
    // Focus must be *visible*, not merely reachable: the browser's default
    // outline is what a `focus:outline-none` in a hover style would remove.
    expect(links[0]).toHaveClass("focus-visible:outline-2");
  });

  it("keeps a row whose owner has never set a display name", async () => {
    // The row exists because the Handle is **claimed**, not because a
    // `display_name` was filled in. Dropping it would make the listing
    // disagree with the count that chose to render a listing at all — and
    // would hide a real owner's Handle behind a field they left blank.
    readDisplayNames.mockResolvedValue(new Map([[RED_ENCODED, "Ada Rose"]]));

    render(await visit("apple.apple.apple"));

    const rows = within(listing()).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(screen.getByRole("link", { name: GREEN_SPOKEN })).toHaveAttribute(
      "href",
      `/${GREEN_ENCODED}`,
    );
  });

  it("omits the matches nobody has claimed", async () => {
    // "An entry exists because a Profile exists" — an unclaimed or Reserved
    // Handle has no owner to name, and listing one would advertise a Handle
    // that is not somebody's.
    resolveAlias.mockReturnValue({
      ok: true,
      candidates: [redCandidate, greenCandidate, blueCandidate],
    });
    readAvailability.mockImplementation((segment: string) =>
      Promise.resolve(segment === BLUE_ENCODED ? "not-claimable" : "claimed"),
    );

    render(await visit("apple.apple.apple"));

    expect(within(listing()).getAllByRole("listitem")).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(new RegExp(BLUE, "u"));
  });

  it("costs one display-name read for the whole listing, and asks only about the rows it shows", async () => {
    // The availability read already costs one per candidate — ADR-0008's worst
    // measured alias is 64 of them — so the names must not double it. One
    // batched read keeps the page at N + 1.
    resolveAlias.mockReturnValue({
      ok: true,
      candidates: [redCandidate, greenCandidate, blueCandidate],
    });
    readAvailability.mockImplementation((segment: string) =>
      Promise.resolve(segment === BLUE_ENCODED ? "available" : "claimed"),
    );

    render(await visit("apple.apple.apple"));

    expect(readDisplayNames).toHaveBeenCalledTimes(1);
    expect(readDisplayNames).toHaveBeenCalledWith([RED_ENCODED, GREEN_ENCODED]);
    // The single-Profile path must not also run: a listing shows no bio and no
    // Links, so a Profile read here would be work done for nothing — and a
    // Profile fetched for a Handle the visitor was not sent to.
    expect(readProfile).not.toHaveBeenCalled();
  });

  it("still renders the listing when the display names cannot be read", async () => {
    // The names decorate the rows; the emoji are the identity. A refused
    // connection must degrade to emoji-only rows rather than to no page.
    readDisplayNames.mockResolvedValue(new Map());

    render(await visit("apple.apple.apple"));

    expect(within(listing()).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("img", { name: RED_SPOKEN })).toBeInTheDocument();
  });

  it("declares no canonical URL, because it is showing no single Handle", async () => {
    // Decision 5 points `rel="canonical"` at *the* emoji path. A listing has
    // several, and picking one would assert a meaning the alias does not have.
    const metadata = await metadataOf("apple.apple.apple");

    expect(metadata.alternates).toBeUndefined();
    expect(metadata.openGraph?.url).toBeUndefined();
    // Nor does it say whose Handles they are: a listing names its owners on
    // the page, but its unfurl is the site's.
    expect(JSON.stringify(metadata)).not.toMatch(/Ada Rose|Bruno Green/);
    expect(canonicalLink()).toBeNull();
  });

  it("neither redirects nor 404s", async () => {
    render(await visit("apple.apple.apple"));

    expect(permanentRedirect).not.toHaveBeenCalled();
    expect(notFound).not.toHaveBeenCalled();
  });

  it("grows no controls of its own", async () => {
    // The tripwire the other branches carry: this route offers no buttons, and
    // a listing is the branch most likely to sprout a filter or a sort.
    render(await visit("apple.apple.apple"));

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

/**
 * The claim listing: an alias with more than one candidate, **none of them
 * claimed** ([ADR-0011](../../../../../docs/adr/0011-canonical-word-aliases-name-one-handle-and-unclaimed-aliases-list-claimable-handles.md)
 * decision 5, [#121](https://github.com/joshstothard/3moji/issues/121)).
 *
 * `apple.apple.apple` with nothing claimed names no one Handle to offer a claim
 * for, so the visitor is shown the candidates that can be claimed and picks the
 * one they meant. Each row goes to that Handle's own emoji path, where the
 * existing claim call to action is.
 */
describe("a claim listing of the unclaimed Handles an alias names", () => {
  const RED = "\u{1F34E}";
  const GREEN = "\u{1F34F}";
  const BLUE = "\u{1F7E6}";
  const PEAR = "\u{1F350}";
  const SPOKEN_BY_EMOJI: Readonly<Record<string, string>> = {
    [RED]: "three red apples",
    [GREEN]: "three green apples",
    [BLUE]: "three blue squares",
    [PEAR]: "three pears",
  };

  function candidateOf(emoji: string): StubCandidate {
    const key = `${emoji}${emoji}${emoji}`;
    return {
      key,
      encoded: encodeURIComponent(key),
      emoji: [{ emoji }, { emoji }, { emoji }],
    };
  }

  const red = candidateOf(RED);
  const green = candidateOf(GREEN);
  const blue = candidateOf(BLUE);
  const pear = candidateOf(PEAR);

  function canonicalLink(): HTMLLinkElement | null {
    return document.head.querySelector('link[rel="canonical"]');
  }

  /** The listing, by its accessible name rather than by a class or a test id. */
  function claimListing(): HTMLElement {
    return screen.getByRole("list", { name: copy.aliasClaimListingLabel });
  }

  /** Answers `states[encoded]` for each candidate, `available` otherwise. */
  function availabilityBy(
    states: Readonly<Record<string, AvailabilityState>>,
  ): void {
    readAvailability.mockImplementation((segment: string) =>
      Promise.resolve(states[segment] ?? "available"),
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    canonicalise.mockReturnValue({ ok: false, reason: "unknown-codepoint" });
    resolveAlias.mockReturnValue({
      ok: true,
      candidates: [red, green, blue, pear],
    });
    // Distinct per Handle, so a row that announced another row's name would
    // fail rather than pass.
    spokenHandle.mockImplementation(
      (codepoints: readonly string[]) =>
        SPOKEN_BY_EMOJI[codepoints.at(0) ?? ""],
    );
    readAvailability.mockResolvedValue("available");
    checkAvailability.mockResolvedValue("available");
    readProfile.mockResolvedValue({ state: "none" });
    readDisplayNames.mockResolvedValue(new Map());
  });

  it("lists every candidate that can be claimed, in the resolver's order", async () => {
    render(await visit("apple.apple.apple"));

    expect(
      screen.getByRole("heading", { level: 1, name: copy.aliasSeveralHeading }),
    ).toBeInTheDocument();
    expect(screen.getByText(copy.aliasClaimListing)).toBeInTheDocument();
    const rows = within(claimListing()).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      red.key,
      green.key,
      blue.key,
      pear.key,
    ]);
  });

  it("omits held, Reserved and unreadable candidates, keeping the order of the rest", async () => {
    // Decision 5: a row is a Handle the visitor can go and claim. A held one
    // is somebody's for now, a Reserved one never can be, and one whose read
    // failed cannot be known to be free — the reason `unknown` never renders
    // the builder on its own page either.
    availabilityBy({
      [red.encoded]: "held",
      [green.encoded]: "available",
      [blue.encoded]: "not-claimable",
      [pear.encoded]: "available",
    });

    render(await visit("apple.apple.apple"));

    const links = within(claimListing()).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      `/${green.encoded}`,
      `/${pear.encoded}`,
    ]);
    expect(document.body.textContent).not.toMatch(
      new RegExp(`${RED}|${BLUE}`, "u"),
    );
  });

  it("omits a candidate whose availability could not be read", async () => {
    availabilityBy({ [green.encoded]: "unknown" });

    render(await visit("apple.apple.apple"));

    expect(within(claimListing()).getAllByRole("listitem")).toHaveLength(3);
    expect(document.body.textContent).not.toMatch(new RegExp(GREEN, "u"));
  });

  it("shows each row's emoji with its Spoken Name, as one link to its emoji path", async () => {
    render(await visit("apple.apple.apple"));

    const rows = within(claimListing()).getAllByRole("listitem");
    rows.forEach((row, index) => {
      const candidate = [red, green, blue, pear][index];
      const links = within(row).getAllByRole("link");
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveAttribute("href", `/${candidate?.encoded ?? ""}`);
    });
    expect(
      screen.getByRole("link", { name: "three red apples" }),
    ).toHaveAttribute("href", `/${red.encoded}`);
    expect(
      screen.getByRole("img", { name: "three green apples" }),
    ).toHaveTextContent(green.key);
  });

  it("falls back to the Handle itself when there is no way to say it", async () => {
    spokenHandle.mockReturnValue(undefined);

    render(await visit("apple.apple.apple"));

    expect(screen.getByRole("img", { name: red.key })).toBeInTheDocument();
  });

  it("is keyboard operable, one tab stop per row, with visible focus", async () => {
    const user: UserEvent = userEvent.setup();
    render(await visit("apple.apple.apple"));

    const links = within(claimListing()).getAllByRole("link");
    for (const link of links) {
      await user.tab();
      expect(link).toHaveFocus();
      expect(link).toHaveClass("focus-visible:outline-2");
    }
  });

  it("offers no builder, no claim form and no controls of its own", async () => {
    // The claim call to action lives on each row's own emoji path. Offering it
    // here would be guessing which Handle the visitor meant.
    render(await visit("apple.apple.apple"));

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(
      screen.queryByRole("heading", { name: builderCopy.builderHeading }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(copy.unclaimed)).not.toBeInTheDocument();
  });

  it("declares no canonical URL, because it is showing no single Handle", async () => {
    const metadata = await metadataOf("apple.apple.apple");

    expect(metadata.alternates).toBeUndefined();
    expect(metadata.openGraph?.url).toBeUndefined();
    render(await visit("apple.apple.apple"));
    expect(canonicalLink()).toBeNull();
  });

  it("neither redirects nor 404s", async () => {
    render(await visit("apple.apple.apple"));

    expect(permanentRedirect).not.toHaveBeenCalled();
    expect(notFound).not.toHaveBeenCalled();
  });

  it("still renders the claimed listing, not this one, when two candidates are claimed", async () => {
    // ADR-0011 decision 6: the claimed listing is unchanged, and it still
    // omits the unclaimed candidates.
    availabilityBy({
      [red.encoded]: "claimed",
      [pear.encoded]: "claimed",
    });

    render(await visit("apple.apple.apple"));

    expect(
      screen.queryByRole("list", { name: copy.aliasClaimListingLabel }),
    ).not.toBeInTheDocument();
    expect(
      within(
        screen.getByRole("list", { name: copy.aliasListingLabel }),
      ).getAllByRole("listitem"),
    ).toHaveLength(2);
  });

  describe("when no candidate can be claimed", () => {
    beforeEach(() => {
      availabilityBy({
        [red.encoded]: "held",
        [green.encoded]: "not-claimable",
        [blue.encoded]: "unknown",
        [pear.encoded]: "held",
      });
    });

    it("says so, and lists nothing", async () => {
      render(await visit("apple.apple.apple"));

      expect(
        screen.getByRole("heading", {
          level: 1,
          name: copy.aliasSeveralHeading,
        }),
      ).toBeInTheDocument();
      expect(screen.getByText(copy.aliasNoneClaimable)).toBeInTheDocument();
      expect(screen.queryAllByRole("list")).toHaveLength(0);
      expect(document.body.textContent).not.toMatch(
        new RegExp(`${RED}|${GREEN}|${BLUE}|${PEAR}`, "u"),
      );
    });

    it("offers the Find a Handle lookup, empty", async () => {
      render(await visit("apple.apple.apple"));

      const search = screen.getByRole("search", {
        name: en.HandleLookup.heading,
      });
      expect(search).toHaveAttribute("action", "/find");
      expect(
        within(search).getByRole("searchbox", { name: en.HandleLookup.label }),
      ).toHaveValue("");
    });

    it("is still a page, not a 404, and declares no canonical URL", async () => {
      render(await visit("apple.apple.apple"));

      expect(notFound).not.toHaveBeenCalled();
      expect(
        (await metadataOf("apple.apple.apple")).alternates,
      ).toBeUndefined();
    });
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

    // The share control (#160) is the one button a Profile carries; anything
    // else would be the builder, or a control nobody asked for.
    expect(
      screen.queryAllByRole("button").map((button) => button.textContent),
    ).toEqual([copy.shareCopy]);
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

/**
 * The share control ([#160](https://github.com/joshstothard/3moji/issues/160)):
 * ADR-0008 decision 3's canonical word alias, offered where a claimed Profile
 * is shown and nowhere else. How it copies, announces and falls back is
 * `components/share-link.test.tsx`'s; what belongs here is where it appears and
 * what it is built from.
 */
describe("the share control on a Handle page", () => {
  function shareButton(): HTMLElement | null {
    return screen.queryByRole("button", { name: copy.shareCopy });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BETTER_AUTH_URL = `${ORIGIN}/`;
    canonicalise.mockReturnValue(resolved);
    resolveAlias.mockReturnValue({ ok: false, reason: "not-an-alias" });
    spokenHandle.mockReturnValue(SPOKEN);
    canonicalAliasOf.mockReturnValue(ALIAS);
    readAvailability.mockResolvedValue("claimed");
    checkAvailability.mockResolvedValue("available");
    readProfile.mockResolvedValue({ state: "profile", profile: PROFILE });
    readDisplayNames.mockResolvedValue(new Map());
  });

  it("is offered on a claimed Profile, showing the canonical alias link", async () => {
    render(await visit(ENCODED));

    expect(shareButton()).toBeInTheDocument();
    expect(screen.getByText(SHARE_HREF)).toBeInTheDocument();
  });

  it("builds the link from the Handle's own code points", async () => {
    render(await visit(ENCODED));

    expect(canonicalAliasOf).toHaveBeenCalledWith([ICE, ICE, ICE]);
  });

  it("copies exactly the origin, a slash and the canonical alias", async () => {
    const user = userEvent.setup();
    const writeText = jest.fn((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    render(await visit(ENCODED));

    await user.click(screen.getByRole("button", { name: copy.shareCopy }));

    expect(writeText).toHaveBeenCalledWith(SHARE_HREF);
  });

  it("never offers the percent-encoded emoji URL", async () => {
    render(await visit(ENCODED));

    expect(shareButton()).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(ENCODED);
    expect(document.body.textContent).not.toMatch(/%F0/i);
  });

  it("is offered on the same Profile reached at its word alias", async () => {
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

    expect(shareButton()).toBeInTheDocument();
    expect(screen.getByText(SHARE_HREF)).toBeInTheDocument();
  });

  it("is omitted, not guessed, when no origin is configured", async () => {
    Reflect.deleteProperty(process.env, "BETTER_AUTH_URL");

    render(await visit(ENCODED));

    expect(screen.getByText("Zoe Frost")).toBeInTheDocument();
    expect(shareButton()).not.toBeInTheDocument();
  });

  it("is omitted when the Handle has no canonical alias", async () => {
    canonicalAliasOf.mockReturnValue(undefined);

    render(await visit(ENCODED));

    expect(screen.getByText("Zoe Frost")).toBeInTheDocument();
    expect(shareButton()).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/undefined/);
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
    ["claimed Handle never edited", "claimed", { state: "unedited" }],
  ] as const)(
    "is not offered for a %s",
    async (_name, state: AvailabilityState, profile: ProfileState) => {
      readAvailability.mockResolvedValue(state);
      readProfile.mockResolvedValue(profile);

      render(await visit(ENCODED));

      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
      expect(shareButton()).not.toBeInTheDocument();
      expect(document.body.textContent).not.toContain(ALIAS);
    },
  );

  it("is not offered for an unclaimed Handle", async () => {
    readAvailability.mockResolvedValue("available");

    await renderSettled(await visit(ENCODED));

    expect(shareButton()).not.toBeInTheDocument();
  });

  it("is not offered on a listing of an alias's claimed Handles", async () => {
    const RED = "\u{1F34E}";
    const GREEN = "\u{1F34F}";
    canonicalise.mockReturnValue({ ok: false, reason: "unknown-codepoint" });
    resolveAlias.mockReturnValue({
      ok: true,
      candidates: [RED, GREEN].map((emoji) => ({
        key: `${emoji}${emoji}${emoji}`,
        encoded: encodeURIComponent(`${emoji}${emoji}${emoji}`),
        emoji: [{ emoji }, { emoji }, { emoji }],
      })),
    });

    render(await visit("apple.apple.apple"));

    expect(
      screen.getByRole("list", { name: copy.aliasListingLabel }),
    ).toBeInTheDocument();
    expect(shareButton()).not.toBeInTheDocument();
  });
});
