import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { curatedEmojiSet, RELEASED_CATEGORIES } from "@template/core/browser";
import { EmojiPicker } from "./emoji-picker";
import en from "../../../../packages/shared/messages/en.json";

/**
 * The picker runs against the real Emoji Set, not a stub.
 *
 * `@template/core/browser` is mapped to source in `jest.config.mjs` and reaches
 * no infrastructure, so there is nothing to mock and nothing gained by it: the
 * behaviour worth asserting is that a released emoji is offered under its
 * curated display name, which a fixture of two entries would not prove.
 */
const ICE = "\u{1F9CA}";
const PIZZA = "\u{1F355}";
const GORILLA = "\u{1F98D}";
const copy = en.HandleBuilder;

/**
 * The five categories ADR-0007 has **not** released, spelled out rather than
 * derived from `RELEASED_CATEGORIES`.
 *
 * A test parameterised on the value it constrains constrains nothing: computing
 * "unreleased" as the complement of the released list would keep passing after
 * a bad edit to that list, because the complement would move with it. Spelled
 * out, releasing a category turns this red — which is the point, since the UI
 * is then meant to change and this assertion is the thing that says so.
 */
const UNRELEASED_CATEGORIES = [
  "Objects",
  "People & Body",
  "Smileys & Emotion",
  "Symbols",
  "Travel & Places",
] as const;

function categoryGroup(): HTMLElement {
  return screen.getByRole("group", { name: copy.pickerCategoriesLabel });
}

/** The emoji buttons currently on offer, by accessible name. */
function shownNames(): readonly string[] {
  const grid = screen.queryByRole("list");
  if (grid === null) {
    return [];
  }
  return within(grid)
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label") ?? "");
}

function namesIn(category: string): readonly string[] {
  return curatedEmojiSet
    .filter((entry) => entry.category === category)
    .map((entry) => entry.displayName);
}

/** A class list as tokens, so `border` cannot be satisfied by `border-control`. */
function tokens(element: HTMLElement): readonly string[] {
  return element.className.split(/\s+/);
}

function renderPicker(full = false) {
  const onPick = jest.fn();
  const user = userEvent.setup();
  render(<EmojiPicker onPick={onPick} full={full} />);
  return { onPick, user };
}

describe("the emoji picker's category tabs", () => {
  it("offers one tab per released category and no others", () => {
    renderPicker();

    const tabs = within(categoryGroup()).getAllByRole("button");

    expect(tabs.map((tab) => tab.textContent)).toEqual([
      ...RELEASED_CATEGORIES,
    ]);
  });

  it("offers no tab for a category that has not been released", () => {
    renderPicker();

    for (const category of UNRELEASED_CATEGORIES) {
      expect(
        within(categoryGroup()).queryByRole("button", { name: category }),
      ).toBeNull();
    }
  });

  it("opens on the first released category rather than all 307 at once", () => {
    renderPicker();

    const names = shownNames();

    expect(names).toEqual(namesIn("Food & Drink"));
    expect(names).toContain("ice cube");
    expect(names).not.toContain("gorilla");
  });

  it("shows the picked category's emoji, and says which one is picked", async () => {
    const { user } = renderPicker();

    await user.click(
      within(categoryGroup()).getByRole("button", {
        name: "Animals & Nature",
      }),
    );

    expect(shownNames()).toEqual(namesIn("Animals & Nature"));
    expect(
      within(categoryGroup()).getByRole("button", { name: "Animals & Nature" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(categoryGroup()).getByRole("button", { name: "Food & Drink" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("always has exactly one tab pressed, the one whose emoji are listed", async () => {
    const { user } = renderPicker();

    for (const category of RELEASED_CATEGORIES) {
      await user.click(
        within(categoryGroup()).getByRole("button", { name: category }),
      );

      const pressed = within(categoryGroup())
        .getAllByRole("button")
        .filter((tab) => tab.getAttribute("aria-pressed") === "true")
        .map((tab) => tab.textContent);
      expect(pressed).toEqual([category]);
      expect(shownNames()).toEqual(namesIn(category));
    }
  });

  it("leaves every released emoji reachable across the tabs, and nothing else", async () => {
    const { user } = renderPicker();
    const reachable = new Set<string>();

    for (const category of RELEASED_CATEGORIES) {
      await user.click(
        within(categoryGroup()).getByRole("button", { name: category }),
      );
      for (const name of shownNames()) {
        reachable.add(name);
      }
    }

    expect(reachable.size).toBe(curatedEmojiSet.length);
  });
});

/**
 * The owner asked for the search box to go (#253): the category tabs are the
 * only way to change what is listed. `searchEmoji` stays in `packages/core`
 * for the header search (#254); only the picker's UI is removed.
 */
describe("the emoji picker has no search", () => {
  it("renders no search box or any other text field", () => {
    renderPicker();

    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.querySelector("input")).toBeNull();
  });

  it("says nothing about searching", () => {
    const { container } = render(
      <EmojiPicker onPick={jest.fn()} full={false} />,
    );

    expect(container).not.toHaveTextContent(/search/i);
  });
});

describe("the emoji picker's grid", () => {
  /**
   * jsdom evaluates no CSS, so this pins the classes that size the grid;
   * `emoji-picker.spec.ts` measures the rendered cells in both projects.
   *
   * Five equal columns on a phone, and from `sm` as many columns of at least
   * 4rem as fit, sharing the leftover width — so the grid fills the card
   * evenly at every width rather than leaving a gap on the right.
   */
  it("fills the card evenly: five columns on a phone, 4rem-minimum columns above", () => {
    renderPicker();

    expect(tokens(screen.getByRole("list"))).toEqual(
      expect.arrayContaining([
        "grid",
        "grid-cols-5",
        "sm:grid-cols-[repeat(auto-fill,minmax(4rem,1fr))]",
      ]),
    );
  });

  it("draws every emoji as a square cell with its glyph centred, 36px on a phone and 44px above", () => {
    renderPicker();

    const buttons = within(screen.getByRole("list")).getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(tokens(button)).toEqual(
        expect.arrayContaining([
          "aspect-square",
          "w-full",
          "flex",
          "items-center",
          "justify-center",
          "text-[36px]",
          "sm:text-[44px]",
        ]),
      );
    }
  });

  /**
   * An iPhone draws a grey box over a tapped button and offers a callout on a
   * long-pressed glyph (#253). Neither is a focus indicator, which stays
   * `focus-visible` only, so a keyboard user still sees where they are.
   */
  it("draws no tap highlight, selection or callout on an emoji, and shows focus only when it is visible", () => {
    renderPicker();

    const button = screen.getByRole("button", { name: "ice cube" });

    expect(tokens(button)).toEqual(
      expect.arrayContaining([
        "select-none",
        "[-webkit-tap-highlight-color:transparent]",
        "[-webkit-touch-callout:none]",
        "focus-visible:outline-violet",
      ]),
    );
    expect(tokens(button).some((token) => token.startsWith("focus:"))).toBe(
      false,
    );
  });
});

describe("the emoji picker's accessibility and picking", () => {
  it("names each button by its curated display name, not by its code point", () => {
    renderPicker();

    expect(
      screen.getByRole("button", { name: "ice cube" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "pizza" })).toBeInTheDocument();
  });

  it("hides the glyph itself from assistive technology, so the name is read once", () => {
    renderPicker();

    const button = screen.getByRole("button", { name: "ice cube" });

    expect(button).toHaveTextContent(ICE);
    expect(button.querySelector("[aria-hidden='true']")).toHaveTextContent(ICE);
  });

  it("keeps every control in the tab order, tabs first and then the emoji", async () => {
    const { user } = renderPicker();

    await user.tab();
    expect(
      within(categoryGroup()).getByRole("button", { name: "Food & Drink" }),
    ).toHaveFocus();

    for (let tab = 1; tab < RELEASED_CATEGORIES.length; tab += 1) {
      await user.tab();
    }
    await user.tab();
    expect(
      within(screen.getByRole("list")).getAllByRole("button")[0],
    ).toHaveFocus();
  });

  it("gives every control a visible focus ring, on focus-visible only", () => {
    renderPicker();

    const tab = within(categoryGroup()).getByRole("button", {
      name: "Food & Drink",
    });
    const emoji = screen.getByRole("button", { name: "ice cube" });

    for (const control of [tab, emoji]) {
      expect(tokens(control)).toContain("focus-visible:outline-violet");
      expect(tokens(control).some((token) => token.startsWith("focus:"))).toBe(
        false,
      );
    }
  });

  /**
   * The border is what identifies each button as a control
   * ([#243](https://github.com/joshstothard/3moji/issues/243)): the white fill
   * is about 1.04:1 on the paper page (#251). jsdom evaluates no
   * CSS, so this pins the classes, one token at a time so `border` cannot be
   * satisfied by `border-control`; `accessibility.spec.ts` measures them.
   */
  it("gives every category and emoji button the builder's border", () => {
    renderPicker();

    for (const tab of within(categoryGroup()).getAllByRole("button")) {
      expect(tokens(tab)).toEqual(
        expect.arrayContaining([
          "border",
          "border-control",
          "hover:border-violet",
          // Selected, the tab is ink, as the connected layout draws it
          // (#263), and the border takes the fill's colour: the fill is the
          // cue, 16.87:1 on the paper page.
          "aria-pressed:bg-ink",
          "aria-pressed:border-ink",
        ]),
      );
    }

    const grid = screen.getByRole("list");
    const emojiButtons = within(grid).getAllByRole("button");
    expect(emojiButtons.length).toBeGreaterThan(0);
    for (const button of emojiButtons) {
      expect(tokens(button)).toEqual(
        expect.arrayContaining([
          "border",
          "border-control",
          "hover:border-violet",
          // A full Handle takes the hover affordance away, border included.
          "aria-disabled:hover:border-control",
        ]),
      );
    }
  });

  it("reports the code point of the emoji that was picked", async () => {
    const { onPick, user } = renderPicker();

    await user.click(screen.getByRole("button", { name: "pizza" }));

    expect(onPick).toHaveBeenCalledWith(PIZZA);
  });

  it("reports a pick made from another category's tab", async () => {
    const { onPick, user } = renderPicker();

    await user.click(
      within(categoryGroup()).getByRole("button", {
        name: "Animals & Nature",
      }),
    );
    await user.click(screen.getByRole("button", { name: "gorilla" }));

    expect(onPick).toHaveBeenCalledWith(GORILLA);
  });

  it("marks its buttons aria-disabled when the Handle is full, and stays picky about nothing else", () => {
    renderPicker(true);

    const button = screen.getByRole("button", { name: "ice cube" });

    // aria-disabled rather than `disabled`: a disabled button is removed from
    // the tab order, and a full Handle must not throw away the focus of
    // whoever is standing on it (WCAG 2.4.3, and #78's focus criterion).
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
  });

  it("does not report a pick once the Handle is full", async () => {
    const { onPick, user } = renderPicker(true);

    await user.click(screen.getByRole("button", { name: "ice cube" }));

    expect(onPick).not.toHaveBeenCalled();
  });

  it("keeps the category tabs usable while the Handle is full, so a swap can be lined up", () => {
    renderPicker(true);

    const tab = within(categoryGroup()).getByRole("button", {
      name: "Activities",
    });

    expect(tab).not.toBeDisabled();
    expect(tab).not.toHaveAttribute("aria-disabled", "true");
  });
});
