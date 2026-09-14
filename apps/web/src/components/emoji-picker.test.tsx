import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
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

/**
 * A search term that can only be satisfied by an emoji in an unreleased
 * category — verified against the curated data, which carries none of these
 * words: 😀 is "grinning face", 💼 "briefcase", 🚕 "taxi", ♻️ "recycling
 * symbol", 🤝 "handshake".
 */
const UNRELEASED_NEEDLES: Readonly<Record<string, string>> = {
  "Smileys & Emotion": "grinning",
  Objects: "briefcase",
  "Travel & Places": "taxi",
  Symbols: "recycling",
  "People & Body": "handshake",
};

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

async function search(user: UserEvent, query: string) {
  await user.click(screen.getByLabelText(copy.pickerSearchLabel));
  await user.keyboard(query);
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

describe("the emoji picker's search", () => {
  it("finds an emoji by a synonym it does not display", async () => {
    const { user } = renderPicker();

    // 🍆 displays as "aubergine"; "eggplant" is the CLDR name kept as a
    // synonym, so this can only match through the synonym path.
    await search(user, "eggplant");

    expect(
      screen.getByRole("button", { name: "aubergine" }),
    ).toBeInTheDocument();
    expect(shownNames()).toEqual(["aubergine"]);
  });

  it("finds an emoji by its stored plural", async () => {
    const { user } = renderPicker();

    await search(user, "aubergines");

    expect(shownNames()).toEqual(["aubergine"]);
  });

  it("matches case-insensitively", async () => {
    const { user } = renderPicker();

    await search(user, "ICE CUBE");

    expect(shownNames()).toContain("ice cube");
  });

  it("searches every category, not just the one whose tab is open", async () => {
    const { user } = renderPicker();

    // Food & Drink is open; a gorilla is Animals & Nature.
    await search(user, "gorilla");

    expect(shownNames()).toEqual(["gorilla"]);
  });

  it("returns every emoji an ambiguous term names, which is correct rather than a bug", async () => {
    const { user } = renderPicker();

    // 30 of the 937 search terms are ambiguous: "apple" is both 🍎 and 🍏.
    await search(user, "apple");

    expect(shownNames()).toEqual(
      expect.arrayContaining(["red apple", "green apple"]),
    );
  });

  it("says when nothing matches, rather than rendering an empty grid", async () => {
    const { user } = renderPicker();

    await search(user, "zzzz");

    expect(
      screen.getByText(copy.pickerNoMatches.replace("{query}", "zzzz")),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("says nothing about no matches before anything is typed", () => {
    renderPicker();

    expect(
      screen.queryByText(copy.pickerNoMatches.replace("{query}", "")),
    ).toBeNull();
    expect(shownNames()).not.toEqual([]);
  });

  it.each(Object.entries(UNRELEASED_NEEDLES))(
    "reaches no %s emoji, searching the word only that category carries",
    async (category, needle) => {
      expect(UNRELEASED_CATEGORIES).toContain(category);
      const { user } = renderPicker();

      await search(user, needle);

      expect(shownNames()).toEqual([]);
      expect(
        screen.getByText(copy.pickerNoMatches.replace("{query}", needle)),
      ).toBeInTheDocument();
    },
  );

  it("returns to the open category's emoji when the search is cleared", async () => {
    const { user } = renderPicker();

    await search(user, "gorilla");
    await user.clear(screen.getByLabelText(copy.pickerSearchLabel));

    expect(shownNames()).toEqual(namesIn("Food & Drink"));
  });

  it("abandons the search when a category tab is picked", async () => {
    const { user } = renderPicker();

    await search(user, "gorilla");
    await user.click(
      within(categoryGroup()).getByRole("button", { name: "Activities" }),
    );

    expect(shownNames()).toEqual(namesIn("Activities"));
    expect(screen.getByLabelText(copy.pickerSearchLabel)).toHaveValue("");
  });
});

describe("the emoji picker's accessibility and picking", () => {
  it("labels the search field with a real label, not a placeholder alone", () => {
    renderPicker();

    const field = screen.getByLabelText(copy.pickerSearchLabel);

    expect(field.tagName).toBe("INPUT");
    expect(field).toHaveAccessibleName(copy.pickerSearchLabel);
  });

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

  it("keeps every control in the tab order, tabs and results alike", async () => {
    const { user } = renderPicker();

    await user.tab();
    expect(screen.getByLabelText(copy.pickerSearchLabel)).toHaveFocus();

    await user.tab();
    expect(
      within(categoryGroup()).getByRole("button", { name: "Food & Drink" }),
    ).toHaveFocus();
  });

  it("gives every control a visible focus ring", () => {
    renderPicker();

    const tab = within(categoryGroup()).getByRole("button", {
      name: "Food & Drink",
    });

    expect(tab.className).toContain("focus-visible:outline-indigo-600");
    expect(
      screen.getByRole("button", { name: "ice cube" }).className,
    ).toContain("focus-visible:outline-indigo-600");
  });

  /**
   * The border is what identifies each button as a control
   * ([#243](https://github.com/joshstothard/3moji/issues/243)): the white fill
   * and `shadow-sm` are about 1.05:1 on the `slate-50` page. jsdom evaluates no
   * CSS, so this pins the classes, one token at a time so `border` cannot be
   * satisfied by `border-slate-500`; `accessibility.spec.ts` measures them.
   */
  it("gives every category and emoji button the builder's border", () => {
    renderPicker();
    const tokens = (element: HTMLElement) => element.className.split(/\s+/);

    for (const tab of within(categoryGroup()).getAllByRole("button")) {
      expect(tokens(tab)).toEqual(
        expect.arrayContaining([
          "border",
          "border-slate-500",
          "hover:border-indigo-600",
          // Selected, the border takes the fill's colour: nothing is 3:1
          // against both `indigo-600` and the page, so the fill is the cue.
          "aria-pressed:border-indigo-600",
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
          "border-slate-500",
          "hover:border-indigo-600",
          // A full Handle takes the hover affordance away, border included.
          "aria-disabled:hover:border-slate-500",
        ]),
      );
    }
  });

  it("reports the code point of the emoji that was picked", async () => {
    const { onPick, user } = renderPicker();

    await user.click(screen.getByRole("button", { name: "pizza" }));

    expect(onPick).toHaveBeenCalledWith(PIZZA);
  });

  it("reports a pick made from the search results too", async () => {
    const { onPick, user } = renderPicker();

    await search(user, "eggplant");
    await user.click(screen.getByRole("button", { name: "aubergine" }));

    expect(onPick).toHaveBeenCalledWith("\u{1F346}");
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
