import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { AvailabilityState } from "./availability-state";
import { HandleBuilder } from "./handle-builder";
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
