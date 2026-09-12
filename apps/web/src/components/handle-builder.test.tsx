import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { AvailabilityState } from "./availability-state";
import { HandleBuilder } from "./handle-builder";
import { findEmojiByCodepoint } from "@template/core/browser";
import en from "../../../../packages/shared/messages/en.json";

/**
 * The builder is driven through the interface, against the real Emoji Set.
 *
 * The one collaborator that is faked is the availability read, because it is
 * the only one that leaves the browser: it is a server action, injected as a
 * prop precisely so a test passes a fake in rather than patching a module
 * (`docs/development/engineering-standards.md` § The composition root).
 */
const ICE = "\u{1F9CA}";
const ENCODED_ICE_TRIPLE = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";
const copy = en.HandleBuilder;

function slot(position: number): HTMLElement {
  return screen.getByRole("button", {
    name: copy.slotEmpty.replace("{position}", String(position)),
  });
}

function filledSlot(position: number, name: string): HTMLElement {
  return screen.getByRole("button", {
    name: copy.slotFilled
      .replace("{position}", String(position))
      .replace("{name}", name),
  });
}

function emoji(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

async function pick(user: UserEvent, ...names: readonly string[]) {
  for (const name of names) {
    await user.click(emoji(name));
  }
}

function renderBuilder(
  checkAvailability: (segment: string) => Promise<AvailabilityState> = jest.fn(
    (_segment: string) => Promise.resolve("available" as const),
  ),
) {
  const user = userEvent.setup();
  render(<HandleBuilder checkAvailability={checkAvailability} />);
  return { user, checkAvailability };
}

describe("the Handle builder", () => {
  it("starts with three empty slots", () => {
    renderBuilder();

    expect(slot(1)).toBeInTheDocument();
    expect(slot(2)).toBeInTheDocument();
    expect(slot(3)).toBeInTheDocument();
  });

  it("fills the slots left to right as emoji are picked", async () => {
    const { user } = renderBuilder();

    await pick(user, "ice cube");
    expect(filledSlot(1, "ice cube")).toBeInTheDocument();
    expect(slot(2)).toBeInTheDocument();

    await pick(user, "pizza");
    expect(filledSlot(2, "pizza")).toBeInTheDocument();
    expect(slot(3)).toBeInTheDocument();
  });

  it("clears a slot when its own button is activated", async () => {
    const { user } = renderBuilder();

    await pick(user, "ice cube");
    await user.click(filledSlot(1, "ice cube"));

    expect(slot(1)).toBeInTheDocument();
  });

  it("says nothing about how to say an empty Handle, and never says undefined", () => {
    renderBuilder();

    expect(screen.getByText(copy.spokenEmpty)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/undefined/);
  });

  it("reads three of the same emoji as the product's founding line", async () => {
    const { user } = renderBuilder();

    await pick(user, "ice cube", "ice cube", "ice cube");

    expect(
      screen.getByText(copy.spoken.replace("{spoken}", "three ice cubes")),
    ).toBeInTheDocument();
  });

  it("reads a mixed Handle in order, without collapsing the split run", async () => {
    const { user } = renderBuilder();

    await pick(user, "ice cube", "pizza", "ice cube");

    expect(
      screen.getByText(
        copy.spoken.replace("{spoken}", "an ice cube, a pizza and an ice cube"),
      ),
    ).toBeInTheDocument();
  });

  it("updates the spoken form before the Handle is complete", async () => {
    const { user } = renderBuilder();

    await pick(user, "ice cube");

    expect(
      screen.getByText(copy.spoken.replace("{spoken}", "an ice cube")),
    ).toBeInTheDocument();
  });

  it("previews the URL as the Handle is built, labelled by its spoken form", async () => {
    const { user } = renderBuilder();

    await pick(user, "ice cube", "ice cube", "ice cube");

    const preview = screen.getByRole("img", { name: "three ice cubes" });
    expect(preview).toHaveTextContent(`${ICE}${ICE}${ICE}`);
    expect(screen.getByText(/3moji\.me\//)).toBeInTheDocument();
  });

  it("asks about availability only once all three slots are filled", async () => {
    const checkAvailability = jest.fn((_segment: string) =>
      Promise.resolve("available" as const),
    );
    const { user } = renderBuilder(checkAvailability);

    await pick(user, "ice cube", "ice cube");
    expect(checkAvailability).not.toHaveBeenCalled();

    await pick(user, "ice cube");
    await waitFor(() => {
      expect(checkAvailability).toHaveBeenCalledWith(ENCODED_ICE_TRIPLE);
    });
  });

  it.each([
    ["available", copy.stateAvailable],
    ["held", copy.stateHeld],
    ["claimed", copy.stateClaimed],
    ["not-claimable", copy.stateNotClaimable],
    ["not-a-handle", copy.stateNotAHandle],
    ["unknown", copy.stateUnknown],
  ] as const)("reports the %s answer", async (state, text) => {
    const { user } = renderBuilder(jest.fn(() => Promise.resolve(state)));

    await pick(user, "ice cube", "ice cube", "ice cube");

    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("reports a failed check rather than letting the rejection escape", async () => {
    const { user } = renderBuilder(
      jest.fn(() => Promise.reject(new Error("no database"))),
    );

    await pick(user, "ice cube", "ice cube", "ice cube");

    expect(await screen.findByText(copy.stateUnknown)).toBeInTheDocument();
  });

  it("drops the answer as soon as the Handle changes, so no stale verdict is shown", async () => {
    const { user } = renderBuilder(
      jest.fn(() => Promise.resolve("claimed" as const)),
    );

    await pick(user, "ice cube", "ice cube", "ice cube");
    expect(await screen.findByText(copy.stateClaimed)).toBeInTheDocument();

    await user.click(filledSlot(3, "ice cube"));

    expect(screen.queryByText(copy.stateClaimed)).not.toBeInTheDocument();
  });

  it("offers nothing irreversible: no claim, no link, before or after three slots are filled", async () => {
    const { user } = renderBuilder();

    expect(screen.queryAllByRole("link")).toHaveLength(0);

    await pick(user, "ice cube", "ice cube", "ice cube");
    await screen.findByText(copy.stateAvailable);

    // Claiming is #81. Anything here that submits, links out or posts is the
    // signal this component has grown past the builder shell.
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(document.querySelectorAll("form")).toHaveLength(0);
  });

  describe("swap suggestions", () => {
    /**
     * The suggestions come from the real domain: `@template/core/browser` is
     * mapped to source in this suite, so `swapSuggestions` runs for real
     * against the real Emoji Set and the real Reserved Handle list. A stubbed
     * one would assert nothing about the acceptance criterion, which is that
     * the swaps share the picked emoji's Unicode group.
     */
    const PIZZA = "\u{1F355}";

    function swaps(): readonly HTMLElement[] {
      return screen.queryAllByRole("button", { name: /^Use / });
    }

    async function pickTakenPizza(state: AvailabilityState = "claimed") {
      const { user } = renderBuilder(jest.fn(() => Promise.resolve(state)));
      await pick(user, "pizza", "pizza", "pizza");
      return user;
    }

    it.each(["claimed", "held", "not-claimable"] as const)(
      "offers swaps when the pick comes back %s",
      async (state) => {
        await pickTakenPizza(state);

        await waitFor(() => {
          expect(swaps()).toHaveLength(3);
        });
      },
    );

    it.each([
      ["available", copy.stateAvailable],
      ["unknown", copy.stateUnknown],
      ["not-a-handle", copy.stateNotAHandle],
    ] as const)(
      "offers no swaps when the answer is %s: there is nothing to swap away from",
      async (state, text) => {
        await pickTakenPizza(state);
        await screen.findByText(text);

        expect(swaps()).toHaveLength(0);
      },
    );

    it("offers no swaps before the Handle is complete", async () => {
      const { user } = renderBuilder(jest.fn(() => Promise.resolve("claimed")));

      await pick(user, "pizza", "pizza");

      expect(swaps()).toHaveLength(0);
    });

    it("changes exactly one emoji per suggestion, keeping the rest of the pick", async () => {
      await pickTakenPizza();
      await waitFor(() => {
        expect(swaps()).toHaveLength(3);
      });

      for (const button of swaps()) {
        const emoji = Array.from(button.textContent);

        expect(emoji).toHaveLength(3);
        expect(emoji.filter((each) => each !== PIZZA)).toHaveLength(1);
      }
    });

    it("swaps within the picked emoji's own theme, never across the whole set", async () => {
      // A pizza is Food & Drink. Every swap offered for it must also be Food &
      // Drink, per ADR-0005 decision 4 — which is why the Emoji Set carries
      // the Unicode group and no colour field.
      await pickTakenPizza();
      await waitFor(() => {
        expect(swaps()).toHaveLength(3);
      });

      const swapped = swaps().flatMap((button) =>
        Array.from(button.textContent).filter((each) => each !== PIZZA),
      );

      expect(swapped).toHaveLength(3);
      for (const each of swapped) {
        expect(findEmojiByCodepoint(each)?.category).toBe("Food & Drink");
      }
    });

    it("never suggests the Handle that was just refused", async () => {
      await pickTakenPizza();
      await waitFor(() => {
        expect(swaps()).toHaveLength(3);
      });

      for (const button of swaps()) {
        expect(button.textContent).not.toBe(`${PIZZA}${PIZZA}${PIZZA}`);
      }
    });

    it("fills the slots with the suggestion when one is activated, and re-checks it", async () => {
      const checkAvailability = jest.fn((_segment: string) =>
        Promise.resolve("claimed" as const),
      );
      const { user } = renderBuilder(checkAvailability);
      await pick(user, "pizza", "pizza", "pizza");
      await waitFor(() => {
        expect(swaps()).toHaveLength(3);
      });

      const [first] = swaps();
      if (first === undefined) throw new Error("no suggestion to activate");
      const suggested = first.textContent;
      await user.click(first);

      await waitFor(() => {
        expect(checkAvailability).toHaveBeenCalledWith(
          encodeURIComponent(suggested),
        );
      });
      expect(
        screen.getByRole("img", { name: /pizza|grape/i }),
      ).toHaveTextContent(suggested);
    });

    it("names each suggestion by how it is said, not by its code points", async () => {
      // The product is a URL you can say out loud, so the accessible name is
      // the Spoken Name; the glyphs are aria-hidden, as in the slots.
      await pickTakenPizza();
      await waitFor(() => {
        expect(swaps()).toHaveLength(3);
      });

      const [first] = swaps();
      expect(first?.getAttribute("aria-label")).toMatch(/^Use .*pizza/);
      expect(first?.querySelector("[aria-hidden='true']")).not.toBeNull();
    });

    it("moves focus to the slot that changed, so a swap is never a focus loss", async () => {
      // Activating a suggestion unmounts the button that had focus, which is
      // the regression class the permanent controls exist to prevent. Focus is
      // therefore moved deliberately, to the one slot whose emoji changed — a
      // permanent control that cannot be unmounted under a keyboard user.
      const { user } = renderBuilder(jest.fn(() => Promise.resolve("claimed")));
      await pick(user, "pizza", "pizza", "pizza");
      await waitFor(() => {
        expect(swaps()).toHaveLength(3);
      });

      const [, second] = swaps();
      if (second === undefined) throw new Error("expected three suggestions");
      second.focus();
      await user.keyboard("{Enter}");

      // The suggestions are spread one per position in order, so the second
      // one changes slot 2.
      expect(document.body).not.toHaveFocus();
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: /^Slot 2: (?!empty)/ }),
      );
    });

    it("is reachable by keyboard alone", async () => {
      const { user } = renderBuilder(jest.fn(() => Promise.resolve("claimed")));
      await pick(user, "pizza", "pizza", "pizza");
      await waitFor(() => {
        expect(swaps()).toHaveLength(3);
      });

      const [first] = swaps();
      if (first === undefined) throw new Error("expected a suggestion");
      first.focus();

      expect(first).toHaveFocus();
      expect(first.tabIndex).toBeGreaterThanOrEqual(0);
    });

    it("says nothing about when a hold expires while offering the swaps", async () => {
      await pickTakenPizza("held");
      await waitFor(() => {
        expect(swaps()).toHaveLength(3);
      });

      expect(screen.getByText(copy.stateHeld)).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(
        /until|expire|minute|hour|left|remaining|@/i,
      );
    });
  });

  describe("keyboard and focus", () => {
    it("is operable by keyboard alone: every slot and every emoji is tabbable", async () => {
      const { user } = renderBuilder();

      await user.tab();
      expect(slot(1)).toHaveFocus();
      await user.tab();
      expect(slot(2)).toHaveFocus();
      await user.tab();
      expect(slot(3)).toHaveFocus();
    });

    it("fills a slot from the keyboard alone", async () => {
      const { user } = renderBuilder();

      emoji("ice cube").focus();
      await user.keyboard("{Enter}");

      expect(filledSlot(1, "ice cube")).toBeInTheDocument();
    });

    it("keeps focus on the picked emoji when a slot fills", async () => {
      const { user } = renderBuilder();

      const button = emoji("ice cube");
      button.focus();
      await user.keyboard("{Enter}");

      expect(button).toHaveFocus();
      expect(document.activeElement).toBe(button);
    });

    it("keeps focus on the very same slot control when the slot is cleared", async () => {
      // The prototype lost focus here: filling a slot swapped the control for a
      // different element, so clearing unmounted the focused node and focus
      // fell back to <body>. Asserting on the node identity is what catches
      // that — "something still has focus" would pass against the bug.
      const { user } = renderBuilder();

      await pick(user, "ice cube");
      const before = filledSlot(1, "ice cube");
      before.focus();
      await user.keyboard("{Enter}");

      expect(document.activeElement).toBe(before);
      expect(before).toBe(slot(1));
      expect(document.body).not.toHaveFocus();
    });

    it("keeps the emoji buttons focusable once the Handle is full", async () => {
      const { user } = renderBuilder();

      await pick(user, "ice cube", "ice cube", "ice cube");

      const button = emoji("pizza");
      button.focus();

      expect(button).toHaveFocus();
      expect(screen.getByText(copy.pickerFull)).toBeInTheDocument();
    });
  });
});
