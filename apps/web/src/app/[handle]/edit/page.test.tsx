import { render, screen } from "@testing-library/react";
import type { ProfileDraft, ProfileEditAuthority } from "@template/core";

import en from "../../../../../../packages/shared/messages/en.json";

const copy = en.ProfileEdit;

const ICE = "\u{1F9CA}";
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";

interface StubResult {
  readonly ok: boolean;
  readonly key?: string;
  readonly encoded?: string;
  readonly isCanonical?: boolean;
  readonly emoji?: readonly { readonly emoji: string }[];
}

const resolved: StubResult = {
  ok: true,
  key: `${ICE}${ICE}${ICE}`,
  encoded: ENCODED,
  isCanonical: true,
  emoji: [{ emoji: ICE }, { emoji: ICE }, { emoji: ICE }],
};

const canonicalise = jest.fn((_segment: string): StubResult => resolved);
jest.mock("@template/core", () => ({
  canonicalise: (segment: string) => canonicalise(segment),
  spokenHandle: () => "three ice cubes",
}));

/**
 * `jest.setup.ts` mocks these as bare `jest.fn()`, which return `undefined`.
 * Real Next.js throws, and the throw is what makes each guard an early exit —
 * without it execution falls through the refusal and renders the form anyway,
 * which is the opposite of what these tests claim to prove.
 */
const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";
const REDIRECT = "NEXT_REDIRECT";
const notFound = jest.fn((): never => {
  throw new Error(NOT_FOUND);
});
const redirect = jest.fn((_url: string): never => {
  throw new Error(REDIRECT);
});
const permanentRedirect = jest.fn((_url: string): never => {
  throw new Error(REDIRECT);
});
jest.mock("next/navigation", () => ({
  notFound: () => notFound(),
  redirect: (url: string) => redirect(url),
  permanentRedirect: (url: string) => permanentRedirect(url),
}));

let authority: ProfileEditAuthority = { state: "allowed", userId: "owner" };
let draft: ProfileDraft | undefined = {
  displayName: "Ice Cube",
  bio: "Three of them.",
  links: [],
};
const readEditAuthority = jest.fn((_segment: string) =>
  Promise.resolve(authority),
);
const readEditableDraft = jest.fn((_segment: string) => Promise.resolve(draft));
jest.mock("../../../lib/profile-edit", () => ({
  readEditAuthority: (segment: string) => readEditAuthority(segment),
  readEditableDraft: (segment: string) => readEditableDraft(segment),
}));

jest.mock("../../../components/profile-edit-action", () => ({
  saveProfileAction: jest.fn(),
}));

import EditProfilePage from "./page";

const open = (handle = ENCODED) =>
  EditProfilePage({ params: Promise.resolve({ handle }) });

const refusal = async (handle = ENCODED): Promise<string> =>
  open(handle)
    .then(() => "rendered")
    .catch((error: unknown) =>
      error instanceof Error ? error.message : "not an error",
    );

beforeEach(() => {
  notFound.mockClear();
  redirect.mockClear();
  canonicalise.mockReturnValue(resolved);
  authority = { state: "allowed", userId: "owner" };
  draft = { displayName: "Ice Cube", bio: "Three of them.", links: [] };
});

describe("the edit page, for the owner", () => {
  it("renders the form, opened on the Profile as it stands", async () => {
    render(await open());

    expect(screen.getByLabelText(copy.displayNameLabel)).toHaveValue(
      "Ice Cube",
    );
    expect(screen.getByRole("button", { name: copy.save })).toBeInTheDocument();
  });

  /**
   * A Profile that could not be read is **not** an empty one. Rendering blanks
   * would invite the owner to save them over content that is still there — the
   * one failure on this page that destroys somebody's Profile.
   */
  it("refuses to open a form it could not fill", async () => {
    draft = undefined;

    render(await open());

    expect(screen.queryByLabelText(copy.displayNameLabel)).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(copy.unreadable);
  });
});

/**
 * **No edit surface for anyone but the owner**, asserted separately for each
 * refusal. The action enforces the same rule itself
 * (`profile-edit-action.test.ts`) — this is the layer that decides whether a
 * form is ever rendered, and the two are independent on purpose.
 */
describe("the edit page refuses everyone else", () => {
  it("sends a signed-out visitor to sign in", async () => {
    authority = { state: "signed-out" };

    expect(await refusal()).toBe(REDIRECT);
    expect(redirect).toHaveBeenCalledWith("/sign-in");
    expect(notFound).not.toHaveBeenCalled();
  });

  /**
   * **The case that matters.** Signed in, with a live Account and a Handle of
   * their own, asking for somebody else's: a 404, which says nothing about
   * whether the Handle exists or who owns it.
   */
  it("shows a signed-in visitor who owns a different Handle nothing at all", async () => {
    authority = { state: "not-owner" };

    expect(await refusal()).toBe(NOT_FOUND);
    expect(notFound).toHaveBeenCalledTimes(1);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("shows an Account with no Handle nothing at all", async () => {
    authority = { state: "no-handle" };

    expect(await refusal()).toBe(NOT_FOUND);
  });

  it("shows a holder whose Claim is unfinished nothing at all", async () => {
    authority = { state: "not-claimed" };

    expect(await refusal()).toBe(NOT_FOUND);
  });

  /**
   * The refusal happens **before** anything is read about the Profile: a page
   * that fetched first and refused afterwards would answer 404 while having
   * already asked the database about somebody else's Profile.
   */
  it("reads nothing about the Profile before refusing", async () => {
    authority = { state: "not-owner" };
    readEditableDraft.mockClear();

    await refusal();

    expect(readEditableDraft).not.toHaveBeenCalled();
  });
});

describe("the edit page's canonicalisation", () => {
  it("404s a segment that is not a Handle", async () => {
    canonicalise.mockReturnValue({ ok: false });

    expect(await refusal("not-emoji")).toBe(NOT_FOUND);
    expect(readEditAuthority).not.toHaveBeenCalledWith("not-emoji");
  });

  /**
   * A non-canonical spelling redirects **to the canonical edit URL**, not to
   * the Profile page: otherwise `/🧊🧊🧊%EF%B8%8F/edit` would silently drop the
   * owner out of the form they asked for.
   */
  it("redirects a non-canonical spelling to the canonical edit URL", async () => {
    canonicalise.mockReturnValue({ ...resolved, isCanonical: false });

    expect(await refusal("anything")).toBe(REDIRECT);
    expect(permanentRedirect).toHaveBeenCalledWith(`/${ENCODED}/edit`);
  });
});
