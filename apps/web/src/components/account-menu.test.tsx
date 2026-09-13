import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import en from "../../../../packages/shared/messages/en.json";

const copy = en.AccountMenu;

/**
 * The navbar's signed-in indicator (#193), a client island.
 *
 * It is the only part of the shell that knows who is looking, and it learns it
 * **after** the page has arrived, from `GET /api/viewer` — so the
 * server-rendered HTML of every page, the public Profile included, is the same
 * bytes for every visitor. Written from the issue's acceptance criteria: an
 * owner sees their own Profile and edit links, a signed-out visitor sees a
 * sign-in link, and nobody is ever shown anybody else's.
 */

const ICE = "\u{1F9CA}\u{1F9CA}\u{1F9CA}";
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";

let pathname = "/";
jest.mock("next/navigation", () => ({
  usePathname: () => pathname,
  redirect: jest.fn(),
  notFound: jest.fn(),
}));

/**
 * The sign-out server action (#194), recorded rather than run: this suite is
 * about what the island does around it. The action itself is
 * `sign-out-action.test.ts`.
 */
const signOutFormAction = jest.fn((): Promise<void> => Promise.resolve());
jest.mock("./sign-out-action", () => ({
  signOutFormAction: (): Promise<void> => signOutFormAction(),
}));

import type { ViewerSummary } from "@template/core";
import {
  AccountMenu,
  VIEWER_CHANGED_EVENT,
  type ViewerAnswer,
} from "./account-menu";

/**
 * The island's own reading of the route's JSON is `viewerSummary`'s answer,
 * exactly. It is declared in the component because the browser entry point may
 * not reach `src/auth`; this fails to compile the moment the two drift.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const answerMatchesTheRule: Same<ViewerAnswer, ViewerSummary> = true;

/** A minimal stand-in for a fetch `Response`: only what the island reads. */
interface FakeResponse {
  readonly ok: boolean;
  readonly json: () => Promise<unknown>;
}

const fetchMock = jest.fn<Promise<FakeResponse>, [string, RequestInit?]>();

function answer(body: unknown, status = 200): Promise<FakeResponse> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  });
}

const OWNER = { state: "owner", key: ICE, encoded: ENCODED };

beforeEach(() => {
  pathname = "/";
  signOutFormAction.mockReset();
  signOutFormAction.mockImplementation(() => Promise.resolve());
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => answer({ state: "signed-out" }));
  Object.defineProperty(globalThis, "fetch", {
    value: fetchMock,
    writable: true,
    configurable: true,
  });
});

function hrefs(): (string | null)[] {
  return screen.queryAllByRole("link").map((link) => link.getAttribute("href"));
}

describe("AccountMenu", () => {
  it("reads the route's answer as exactly viewerSummary's shape", () => {
    expect(answerMatchesTheRule).toBe(true);
  });

  it("asks the viewer route, never from a cache", async () => {
    render(<AccountMenu />);

    await screen.findByRole("link", { name: copy.signIn });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/viewer",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("shows nothing to follow or press before the answer arrives", () => {
    fetchMock.mockImplementation(
      () => new Promise<FakeResponse>(() => undefined),
    );

    render(<AccountMenu />);

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("offers a signed-out visitor a sign-in link, and nothing else", async () => {
    render(<AccountMenu />);

    expect(
      await screen.findByRole("link", { name: copy.signIn }),
    ).toHaveAttribute("href", "/sign-in");
    expect(hrefs()).toEqual(["/sign-in"]);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("shows an owner a signed-in indicator that opens onto their own Profile and its edit page", async () => {
    fetchMock.mockImplementation(() => answer(OWNER));
    const user = userEvent.setup();
    render(<AccountMenu />);

    const toggle = await screen.findByRole("button", { name: copy.toggle });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: copy.signIn })).toBeNull();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("link", { name: copy.yourProfile }),
    ).toHaveAttribute("href", `/${ENCODED}`);
    expect(
      screen.getByRole("link", { name: copy.editProfile }),
    ).toHaveAttribute("href", `/${ENCODED}/edit`);
    expect(hrefs()).toEqual([`/${ENCODED}`, `/${ENCODED}/edit`]);
  });

  it("shows the Handle the indicator is signed in as", async () => {
    fetchMock.mockImplementation(() => answer(OWNER));
    render(<AccountMenu />);

    const toggle = await screen.findByRole("button", { name: copy.toggle });
    expect(toggle).toHaveTextContent(ICE);
  });

  it("shows a signed-in Account with no Handle to link the indicator, and no Handle links", async () => {
    fetchMock.mockImplementation(() => answer({ state: "signed-in" }));
    const user = userEvent.setup();
    render(<AccountMenu />);

    await user.click(await screen.findByRole("button", { name: copy.toggle }));

    expect(screen.getByText(copy.noHandle)).toBeInTheDocument();
    expect(hrefs()).toEqual([]);
  });

  it.each([
    ["a refused request", () => Promise.reject(new Error("offline"))],
    ["a server error", () => answer(OWNER, 500)],
    ["an owner answer with no Handle in it", () => answer({ state: "owner" })],
    [
      "an answer whose path is not a path",
      () => answer({ state: "owner", key: ICE, encoded: "//evil.example/%F0" }),
    ],
    ["an unknown state", () => answer({ state: "admin" })],
    [
      "a body that is not JSON",
      () =>
        Promise.resolve({
          ok: true,
          json: () => Promise.reject(new SyntaxError("Unexpected token <")),
        }),
    ],
  ])("falls back to the sign-in link on %s", async (_name, reply) => {
    fetchMock.mockImplementation(reply);
    render(<AccountMenu />);

    expect(
      await screen.findByRole("link", { name: copy.signIn }),
    ).toHaveAttribute("href", "/sign-in");
    expect(hrefs()).toEqual(["/sign-in"]);
  });

  it("asks again when the page changes, so signing in shows without a reload", async () => {
    const { rerender } = render(<AccountMenu />);
    await screen.findByRole("link", { name: copy.signIn });

    fetchMock.mockImplementation(() => answer(OWNER));
    pathname = `/${ENCODED}`;
    rerender(<AccountMenu />);

    expect(
      await screen.findByRole("button", { name: copy.toggle }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("asks again when told the viewer changed, for a sign-out that stays on the same page", async () => {
    fetchMock.mockImplementation(() => answer(OWNER));
    render(<AccountMenu />);
    await screen.findByRole("button", { name: copy.toggle });

    fetchMock.mockImplementation(() => answer({ state: "signed-out" }));
    act(() => {
      window.dispatchEvent(new Event(VIEWER_CHANGED_EVENT));
    });

    expect(
      await screen.findByRole("link", { name: copy.signIn }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.toggle })).toBeNull();
  });

  it("closes on Escape and hands focus back to the toggle", async () => {
    fetchMock.mockImplementation(() => answer(OWNER));
    const user = userEvent.setup();
    render(<AccountMenu />);

    const toggle = await screen.findByRole("button", { name: copy.toggle });
    await user.click(toggle);
    await user.tab();
    expect(screen.getByRole("link", { name: copy.yourProfile })).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
    expect(screen.queryByRole("link", { name: copy.yourProfile })).toBeNull();
  });

  it("closes when the page changes", async () => {
    fetchMock.mockImplementation(() => answer(OWNER));
    const user = userEvent.setup();
    const { rerender } = render(<AccountMenu />);

    await user.click(await screen.findByRole("button", { name: copy.toggle }));
    pathname = `/${ENCODED}/edit`;
    rerender(<AccountMenu />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: copy.toggle })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    });
  });

  describe("sign-out (#194)", () => {
    it.each([
      ["an owner", OWNER],
      ["a signed-in Account with no Handle", { state: "signed-in" }],
    ])(
      "offers %s a sign-out button that submits a form, below the links and never as a link",
      async (_who, body) => {
        fetchMock.mockImplementation(() => answer(body));
        const user = userEvent.setup();
        render(<AccountMenu />);

        await user.click(
          await screen.findByRole("button", { name: copy.toggle }),
        );

        const signOut = screen.getByRole("button", { name: copy.signOut });
        expect(signOut).toHaveAttribute("type", "submit");
        expect(signOut.closest("form")).not.toBeNull();
        expect(screen.queryByRole("link", { name: copy.signOut })).toBeNull();
        // Below the Handle links, when there are any.
        for (const link of screen.queryAllByRole("link")) {
          expect(
            link.compareDocumentPosition(signOut) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          ).toBeTruthy();
        }
      },
    );

    it("offers a signed-out visitor no sign-out", async () => {
      render(<AccountMenu />);

      await screen.findByRole("link", { name: copy.signIn });
      expect(screen.queryByRole("button", { name: copy.signOut })).toBeNull();
    });

    it("signs out when pressed, then asks who is looking again and shows the sign-in link", async () => {
      fetchMock.mockImplementation(() => answer(OWNER));
      const user = userEvent.setup();
      render(<AccountMenu />);
      await user.click(
        await screen.findByRole("button", { name: copy.toggle }),
      );

      fetchMock.mockImplementation(() => answer({ state: "signed-out" }));
      await user.click(screen.getByRole("button", { name: copy.signOut }));

      expect(
        await screen.findByRole("link", { name: copy.signIn }),
      ).toHaveAttribute("href", "/sign-in");
      expect(signOutFormAction).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("button", { name: copy.toggle })).toBeNull();
    });

    it("still asks again when the sign-out request fails, so the indicator shows what is true", async () => {
      fetchMock.mockImplementation(() => answer(OWNER));
      signOutFormAction.mockImplementation(() =>
        Promise.reject(new Error("offline")),
      );
      const user = userEvent.setup();
      render(<AccountMenu />);
      await user.click(
        await screen.findByRole("button", { name: copy.toggle }),
      );

      await user.click(screen.getByRole("button", { name: copy.signOut }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2);
      });
      // Still signed in, so the indicator still says so.
      expect(
        await screen.findByRole("button", { name: copy.toggle }),
      ).toBeInTheDocument();
    });
  });
});
