import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import en from "../../../../packages/shared/messages/en.json";

const copy = en.HeaderSearch;

/**
 * The header search (ADR-0012, #254), a client island.
 *
 * Written from the ADR and the issue's acceptance criteria: a search anyone
 * can use without signing in, asking `GET /api/search?q=` after a 250 ms pause
 * in typing; results in a WAI-ARIA combobox — arrow keys move, Enter opens a
 * Handle's emoji path, Escape closes — and `/` focuses it. On a phone an icon
 * button opens it as a panel. Without JavaScript it is a plain `GET` form to
 * `/find`, the fallback the ADR keeps.
 */

const push = jest.fn();
let pathname = "/";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => pathname,
  redirect: jest.fn(),
  notFound: jest.fn(),
}));

import type { HandleSearch } from "@template/core";
import {
  HeaderSearch,
  SEARCH_DEBOUNCE_MS,
  type SearchAnswer,
} from "./header-search";

/**
 * The island's reading of the route's JSON is `searchHandles`'s answer,
 * exactly. Declared in the component because the root entry point cannot be
 * bundled for the browser; this fails to compile the moment the two drift.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const answerMatchesTheRule: Same<SearchAnswer, HandleSearch> = true;

const ICE = "\u{1F9CA}";
const PIZZA = "\u{1F355}";
const ICE_CUBES = `${ICE}${ICE}${ICE}`;
const ICE_PIZZA = `${ICE}${ICE}${PIZZA}`;

const ANSWER: SearchAnswer = {
  handles: [
    {
      key: ICE_CUBES,
      encoded: encodeURIComponent(ICE_CUBES),
      alias: "ice-cube.ice-cube.ice-cube",
      displayName: "Ada",
    },
    {
      key: ICE_PIZZA,
      encoded: encodeURIComponent(ICE_PIZZA),
      alias: "ice-cube.ice-cube.pizza",
      displayName: null,
    },
  ],
  emoji: [{ emoji: ICE, name: "ice cube" }],
};

interface FakeResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
}

const fetchMock = jest.fn<Promise<FakeResponse>, [string, RequestInit?]>();

function answering(body: unknown, status = 200): void {
  fetchMock.mockImplementation(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  pathname = "/";
  push.mockReset();
  fetchMock.mockReset();
  answering(ANSWER);
  Object.defineProperty(globalThis, "fetch", {
    value: fetchMock,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

function setup() {
  return userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
}

function combobox(): HTMLInputElement {
  const found = screen.getByRole("combobox", { name: copy.label });
  if (!(found instanceof HTMLInputElement)) throw new Error("not an input");
  return found;
}

/** Let the debounce elapse and the answer settle. */
async function pause(ms = SEARCH_DEBOUNCE_MS): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

async function searchFor(
  user: ReturnType<typeof setup>,
  text: string,
): Promise<void> {
  await user.click(combobox());
  await user.type(combobox(), text);
  await pause();
  await screen.findAllByRole("option");
}

describe("HeaderSearch", () => {
  it("declares its answer as the rule's own type", () => {
    expect(answerMatchesTheRule).toBe(true);
  });

  it("is a GET form to /find, so it searches without JavaScript", () => {
    render(<HeaderSearch />);

    const form = screen.getByRole("search", { name: copy.label });
    expect(form).toHaveAttribute("action", "/find");
    expect(form).toHaveAttribute("method", "get");
    expect(combobox()).toHaveAttribute("name", "q");
    expect(combobox()).toHaveAttribute("aria-expanded", "false");
  });

  it("asks nothing below two characters, and once per 250 ms pause in typing", async () => {
    const user = setup();
    render(<HeaderSearch />);

    await user.click(combobox());
    await user.type(combobox(), "i");
    await pause(1000);
    expect(fetchMock).not.toHaveBeenCalled();

    await user.type(combobox(), "ce-cube");
    await pause(SEARCH_DEBOUNCE_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();
    await pause(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/search?q=ice-cube");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("lists each Handle by its spoken name, display name and alias, then the emoji", async () => {
    const user = setup();
    render(<HeaderSearch />);

    await searchFor(user, "ice-cube");

    const [named, unnamed, emoji] = screen.getAllByRole("option");
    expect(named).toHaveAccessibleName(/three ice cubes/);
    expect(named).toHaveAccessibleName(/Ada/);
    expect(named).toHaveTextContent("ice-cube.ice-cube.ice-cube");
    expect(unnamed).toHaveTextContent(copy.noName);
    expect(unnamed).toHaveTextContent("ice-cube.ice-cube.pizza");
    expect(emoji).toHaveAccessibleName(/ice cube/);
    expect(combobox()).toHaveAttribute("aria-expanded", "true");
    expect(combobox()).toHaveAttribute(
      "aria-controls",
      screen.getByRole("listbox").id,
    );
    expect(screen.getByText(copy.claimedOnly)).toBeInTheDocument();
  });

  it("moves through the options with the arrow keys, wrapping, and marks the active one", async () => {
    const user = setup();
    render(<HeaderSearch />);
    await searchFor(user, "ice-cube");
    const options = screen.getAllByRole("option");

    await user.keyboard("{ArrowDown}");
    expect(combobox()).toHaveAttribute("aria-activedescendant", options[0]?.id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");

    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(combobox()).toHaveAttribute("aria-activedescendant", options[0]?.id);

    await user.keyboard("{ArrowUp}");
    expect(combobox()).toHaveAttribute("aria-activedescendant", options[2]?.id);
    expect(combobox()).toHaveFocus();
  });

  it("opens the active Handle's emoji path with Enter", async () => {
    const user = setup();
    render(<HeaderSearch />);
    await searchFor(user, "ice-cube");

    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(push).toHaveBeenCalledWith(`/${encodeURIComponent(ICE_PIZZA)}`);
  });

  it("opens a Handle's emoji path when it is pressed", async () => {
    const user = setup();
    render(<HeaderSearch />);
    await searchFor(user, "ice-cube");

    await user.click(screen.getAllByRole("option")[0] ?? document.body);

    expect(push).toHaveBeenCalledWith(`/${encodeURIComponent(ICE_CUBES)}`);
  });

  it("searches for a chosen emoji, putting it in the box", async () => {
    const user = setup();
    render(<HeaderSearch />);
    await searchFor(user, "ice-cube");

    await user.keyboard("{ArrowUp}{Enter}");
    await pause();

    expect(push).not.toHaveBeenCalled();
    expect(combobox()).toHaveValue(ICE);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
      `/api/search?q=${encodeURIComponent(ICE)}`,
    );
  });

  it("leaves Enter with no active option to the form, which goes to /find", async () => {
    const user = setup();
    render(<HeaderSearch />);
    await searchFor(user, "ice-cube");

    const notPrevented = fireEvent.keyDown(combobox(), { key: "Enter" });

    expect(notPrevented).toBe(true);
    expect(push).not.toHaveBeenCalled();
  });

  it("closes the results with Escape, keeping focus and the words, and clears the box on a second Escape", async () => {
    const user = setup();
    render(<HeaderSearch />);
    await searchFor(user, "ice-cube");

    await user.keyboard("{ArrowDown}{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(combobox()).toHaveAttribute("aria-expanded", "false");
    expect(combobox()).not.toHaveAttribute("aria-activedescendant");
    expect(combobox()).toHaveValue("ice-cube");
    expect(combobox()).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(combobox()).toHaveValue("");
  });

  it("focuses the search when / is pressed on the page, without typing it", async () => {
    const user = setup();
    render(<HeaderSearch />);

    await user.keyboard("/");

    expect(combobox()).toHaveFocus();
    expect(combobox()).toHaveValue("");
  });

  it("leaves / alone while somebody types in another field", async () => {
    const user = setup();
    render(
      <>
        <label>
          Other
          <input />
        </label>
        <HeaderSearch />
      </>,
    );

    await user.click(screen.getByRole("textbox", { name: "Other" }));
    await user.keyboard("/");

    expect(screen.getByRole("textbox", { name: "Other" })).toHaveValue("/");
    expect(combobox()).not.toHaveFocus();
  });

  it("says so when searching is rate limited, and lists nothing", async () => {
    answering(null, 429);
    const user = setup();
    render(<HeaderSearch />);

    await user.click(combobox());
    await user.type(combobox(), "ice-cube");
    await pause();

    expect(await screen.findByRole("status")).toHaveTextContent(
      copy.rateLimited,
    );
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("says when nothing matches", async () => {
    answering({ handles: [], emoji: [] });
    const user = setup();
    render(<HeaderSearch />);

    await user.click(combobox());
    await user.type(combobox(), "wibble");
    await pause();

    expect(await screen.findByRole("status")).toHaveTextContent(copy.noResults);
  });

  it("never links a Handle whose path is not a percent-encoded segment, and drops a malformed answer", async () => {
    answering({
      handles: [
        {
          key: ICE_CUBES,
          encoded: "javascript:alert(1)",
          alias: "ice-cube.ice-cube.ice-cube",
          displayName: "Mallory",
        },
        ...ANSWER.handles.slice(1),
      ],
      emoji: [{ emoji: 7, name: "not an emoji" }],
    });
    const user = setup();
    render(<HeaderSearch />);

    await searchFor(user, "ice-cube");

    expect(screen.queryByText("Mallory")).not.toBeInTheDocument();
    expect(screen.queryByText("not an emoji")).not.toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("opens as a panel from its phone button, focusing the box, and closes back to the button", async () => {
    const user = setup();
    render(<HeaderSearch />);
    const opener = screen.getByRole("button", { name: copy.open });
    expect(opener).toHaveAttribute("aria-expanded", "false");

    await user.click(opener);
    expect(opener).toHaveAttribute("aria-expanded", "true");
    expect(combobox()).toHaveFocus();

    await user.click(screen.getByRole("button", { name: copy.close }));
    expect(opener).toHaveAttribute("aria-expanded", "false");
    expect(opener).toHaveFocus();
  });

  it("closes its results when the page changes", async () => {
    const user = setup();
    const { rerender } = render(<HeaderSearch />);
    await searchFor(user, "ice-cube");

    pathname = `/${encodeURIComponent(ICE_CUBES)}`;
    rerender(<HeaderSearch />);

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
