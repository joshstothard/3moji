import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import type { AvailabilityState } from "./availability-state";
import type { ClaimFormState } from "./claim-action";
import { HandleBuilder } from "./handle-builder";
import {
  emulateViewport,
  installDialogStandIn,
} from "../test-support/viewport";
import en from "../../../../packages/shared/messages/en.json";

/**
 * The phone's claim sheet ([#263](https://github.com/joshstothard/3moji/issues/263)).
 *
 * On a phone, once the Handle is complete and available, a bottom sheet opens
 * with the Handle, how to say it, its URL, its availability and the claim form.
 * It is a modal dialog: focus moves in and stays in, Escape or its close
 * control dismisses it and puts focus back on the slot bar, the page behind it
 * is inert, and removing an emoji from it closes it.
 *
 * jsdom has no `matchMedia`, no `showModal` and no top layer, so
 * `test-support/viewport.ts` stands in for the first two, and what a browser
 * does with a modal dialog is proved in `e2e/composer.spec.ts`. What is proved
 * here is the builder's side: when the sheet opens, what it holds, where focus
 * is sent, and that there is only ever one claim form and one reachable set of
 * slots.
 */
const copy = en.HandleBuilder;
const claimCopy = en.Claim;

const neverSettles = (_previous: ClaimFormState, _formData: FormData) =>
  new Promise<ClaimFormState>(() => undefined);

let restoreViewport: () => void = () => undefined;

beforeEach(() => {
  installDialogStandIn();
  restoreViewport = emulateViewport("phone");
});

afterEach(() => {
  restoreViewport();
});

function renderOnPhone(state: AvailabilityState = "available") {
  const user = userEvent.setup();
  render(
    <HandleBuilder
      checkAvailability={jest.fn(() => Promise.resolve(state))}
      claim={neverSettles}
    />,
  );
  return { user };
}

async function pickIceCubes(user: UserEvent) {
  for (let picked = 0; picked < 3; picked += 1) {
    await user.click(screen.getByRole("button", { name: "ice cube" }));
  }
}

function composer(): HTMLElement {
  return screen.getByRole("region", { name: copy.builderHeading });
}

function barSlots(): HTMLElement {
  return within(composer()).getByRole("group", { name: copy.slotsLabel });
}

function bar(): HTMLElement {
  const element = composer().querySelector<HTMLElement>("[data-composer-bar]");
  if (element === null) throw new Error("the composer has no Handle bar");
  return element;
}

/** The sticky bar's Claim button (#272), or `null` while it is not offered. */
function barClaim(): HTMLElement | null {
  return within(bar()).queryByRole("button", { name: copy.barClaim });
}

function sheet(): Promise<HTMLElement> {
  return screen.findByRole("dialog", { name: claimCopy.claimHeading });
}

function slotName(position: number, name: string): string {
  return copy.slotFilled
    .replace("{position}", String(position))
    .replace("{name}", name);
}

function tokens(element: Element): readonly string[] {
  return (element.getAttribute("class") ?? "").split(/\s+/);
}

describe("the claim sheet, on a phone", () => {
  it("opens once the Handle is complete and available, holding the Handle, how to say it, its URL, its availability and the claim form", async () => {
    const { user } = renderOnPhone();

    await pickIceCubes(user);
    const dialog = await sheet();

    expect(dialog).toHaveAttribute("open");
    const slots = within(dialog).getByRole("group", { name: copy.slotsLabel });
    expect(within(slots).getAllByRole("button")).toHaveLength(3);
    expect(
      within(dialog).getByText(
        copy.spoken.replace("{spoken}", "three ice cubes"),
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("img", { name: "three ice cubes" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(copy.sheetAvailable)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("form", { name: claimCopy.claimHeading }),
    ).toBeInTheDocument();
  });

  it("stays shut while the Handle is incomplete", async () => {
    const { user } = renderOnPhone();

    await user.click(screen.getByRole("button", { name: "ice cube" }));
    await user.click(screen.getByRole("button", { name: "ice cube" }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    ["claimed", copy.stateClaimed],
    ["held", copy.stateHeld],
    ["unknown", copy.stateUnknown],
  ] as const)(
    "stays shut when the Handle comes back %s",
    async (state, line) => {
      const { user } = renderOnPhone(state);

      await pickIceCubes(user);
      await screen.findByText(line);

      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );

  it("moves focus into the sheet, onto its close control", async () => {
    const { user } = renderOnPhone();

    await pickIceCubes(user);
    const dialog = await sheet();

    await waitFor(() => {
      expect(
        within(dialog).getByRole("button", { name: copy.sheetClose }),
      ).toHaveFocus();
    });
  });

  it("makes the page behind it inert, so the sheet's slots are the only ones left to reach", async () => {
    const { user } = renderOnPhone();

    await pickIceCubes(user);
    const dialog = await sheet();

    expect(composer()).toHaveAttribute("inert");
    expect(barSlots().closest("[inert]")).not.toBeNull();
    const reachable = screen
      .getAllByRole("group", { name: copy.slotsLabel })
      .filter((group) => group.closest("[inert]") === null);
    expect(reachable).toHaveLength(1);
    expect(dialog.contains(reachable[0] ?? null)).toBe(true);
  });

  it("renders the claim form once, in the sheet, and never inline as well", async () => {
    const { user } = renderOnPhone();

    await pickIceCubes(user);
    const dialog = await sheet();

    const forms = document.querySelectorAll("form");
    expect(forms).toHaveLength(1);
    expect(dialog.contains(forms[0] ?? null)).toBe(true);
    // Step 2 keeps its place in the page (#272), but holds no form there.
    const step = composer().querySelector("[data-claim-step]");
    expect(step).toHaveAttribute("data-claim-step", "sheet");
    expect(step?.querySelector("form")).toBeNull();
  });

  describe("step 2 keeps its place in the page (#272)", () => {
    it("is the locked panel before the Handle is available, as the server rendered it, so hydrating moves nothing", async () => {
      const { user } = renderOnPhone("claimed");

      expect(composer().querySelector("[data-claim-step]")).toHaveAttribute(
        "data-claim-step",
        "locked",
      );

      await pickIceCubes(user);
      await screen.findByText(copy.stateClaimed);

      expect(composer().querySelector("[data-claim-step]")).toHaveAttribute(
        "data-claim-step",
        "locked",
      );
    });

    it("is the one #claim on the page, outside the sheet, whether the sheet is open or dismissed", async () => {
      const { user } = renderOnPhone();

      await pickIceCubes(user);
      const dialog = await sheet();

      const whileOpen = document.querySelectorAll("#claim");
      expect(whileOpen).toHaveLength(1);
      expect(dialog.contains(whileOpen[0] ?? null)).toBe(false);

      await user.keyboard("{Escape}");
      await waitFor(() => {
        expect(dialog).not.toHaveAttribute("open");
      });

      const target = document.querySelectorAll("#claim");
      expect(target).toHaveLength(1);
      expect(target[0]?.closest("[data-claim-step]")).not.toBeNull();
    });

    it("holds the control that opens the sheet again, once it is dismissed", async () => {
      const { user } = renderOnPhone();

      await pickIceCubes(user);
      const dialog = await sheet();
      await user.keyboard("{Escape}");
      await waitFor(() => {
        expect(dialog).not.toHaveAttribute("open");
      });

      const step = composer().querySelector<HTMLElement>(
        '[data-claim-step="sheet"]',
      );
      if (step === null) throw new Error("step 2 is not on the page");
      const reopen = within(step).getByRole("button", {
        name: copy.sheetReopen,
      });
      expect(screen.getAllByRole("button", { name: copy.sheetReopen })).toEqual(
        [reopen],
      );

      await user.click(reopen);

      expect(await sheet()).toHaveAttribute("open");
    });
  });

  it("keeps Tab inside the sheet: on from the last control to the first, back from the first to the last", async () => {
    const { user } = renderOnPhone();

    await pickIceCubes(user);
    const dialog = await sheet();
    const close = within(dialog).getByRole("button", { name: copy.sheetClose });
    const submit = within(dialog).getByRole("button", {
      name: claimCopy.claimSubmit,
    });

    submit.focus();
    await user.tab();
    expect(close).toHaveFocus();

    await user.tab({ shift: true });
    expect(submit).toHaveFocus();
  });

  it("closes on Escape and puts focus on the Claim button in the Handle bar", async () => {
    const { user } = renderOnPhone();

    await pickIceCubes(user);
    const dialog = await sheet();
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(dialog).not.toHaveAttribute("open");
    });
    expect(composer()).not.toHaveAttribute("inert");
    expect(barClaim()).toHaveFocus();
  });

  it("closes from its close control the same way", async () => {
    const { user } = renderOnPhone();

    await pickIceCubes(user);
    const dialog = await sheet();
    await user.click(
      within(dialog).getByRole("button", { name: copy.sheetClose }),
    );

    await waitFor(() => {
      expect(dialog).not.toHaveAttribute("open");
    });
    expect(barClaim()).toHaveFocus();
  });

  describe("the Claim button in the sticky Handle bar (#272)", () => {
    it("is not offered while the Handle is incomplete, or once it is complete but not available", async () => {
      const { user } = renderOnPhone("claimed");

      await user.click(screen.getByRole("button", { name: "ice cube" }));
      await user.click(screen.getByRole("button", { name: "ice cube" }));
      expect(barClaim()).toBeNull();

      await user.click(screen.getByRole("button", { name: "ice cube" }));
      await screen.findByText(copy.stateClaimed);
      expect(barClaim()).toBeNull();
    });

    it("is not offered while the sheet is open, appears when it is dismissed, and opens the sheet again", async () => {
      const { user } = renderOnPhone();

      await pickIceCubes(user);
      const dialog = await sheet();
      expect(barClaim()).toBeNull();
      expect(tokens(screen.getByText(copy.stateAvailable))).not.toContain(
        "max-md:sr-only",
      );

      await user.keyboard("{Escape}");
      await waitFor(() => {
        expect(dialog).not.toHaveAttribute("open");
      });

      const button = barClaim();
      expect(button).toHaveTextContent(copy.barClaim);
      expect(button).toHaveFocus();
      // The pill takes the availability line's place on screen, and the line
      // is still read out.
      expect(tokens(screen.getByText(copy.stateAvailable))).toContain(
        "max-md:sr-only",
      );
      if (button === null) throw new Error("no Claim button in the bar");
      await user.click(button);

      expect(await sheet()).toHaveAttribute("open");
      expect(barClaim()).toBeNull();
    });

    it("has its room kept in the bar from the moment all three are picked, so it appears without moving anything, on a phone only", async () => {
      const { user } = renderOnPhone("claimed");
      expect(bar().querySelector("[data-bar-claim]")).toBeNull();

      await pickIceCubes(user);
      await screen.findByText(copy.stateClaimed);

      const room = bar().querySelector("[data-bar-claim]");
      if (room === null) throw new Error("the bar keeps no room for Claim");
      expect(tokens(room)).toEqual(
        expect.arrayContaining([
          "shrink-0",
          "h-11",
          "w-18",
          "md:hidden",
          "pointer-events-none",
        ]),
      );
      expect(room.querySelector("button")).toBeNull();
      // With no pill in it, the availability line runs on across the empty
      // room, so "This Handle is taken." stays on one line beside the slots.
      const line = screen.getByText(copy.stateClaimed);
      expect(tokens(line)).not.toContain("max-md:sr-only");
      const paragraph = line.closest("p");
      if (paragraph === null) {
        throw new Error("the availability line is not in a paragraph");
      }
      // And it is one line whatever it says, so "Checking whether this Handle
      // is free…" becoming "This Handle is available." changes no height and
      // moves nothing in the bar. Every word is still announced.
      expect(tokens(paragraph)).toEqual(
        expect.arrayContaining([
          "max-md:w-[calc(100%+5.25rem)]",
          "max-md:truncate",
        ]),
      );
    });

    it("has its room in the server's HTML for a complete Handle, so hydrating on a phone moves nothing", () => {
      const html = renderToString(
        <HandleBuilder
          checkAvailability={jest.fn(() =>
            Promise.resolve("available" as const),
          )}
          claim={neverSettles}
          initialAvailability="available"
          initialEmoji={["\u{1F9CA}", "\u{1F9CA}", "\u{1F355}"]}
        />,
      );

      expect(html).toContain("data-bar-claim");
    });
  });

  it("stays shut for the same Handle once dismissed, and offers a control that opens it again", async () => {
    const { user } = renderOnPhone();

    await pickIceCubes(user);
    const dialog = await sheet();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(dialog).not.toHaveAttribute("open");
    });

    await user.click(screen.getByRole("button", { name: copy.sheetReopen }));

    expect(await sheet()).toHaveAttribute("open");
  });

  it("closes when an emoji is removed from it, and goes back to browsing with focus on that slot in the bar", async () => {
    const { user } = renderOnPhone();

    await pickIceCubes(user);
    const dialog = await sheet();
    await user.click(
      within(dialog).getByRole("button", { name: slotName(2, "ice cube") }),
    );

    await waitFor(() => {
      expect(dialog).not.toHaveAttribute("open");
    });
    const emptied = within(barSlots()).getByRole("button", {
      name: copy.slotEmpty.replace("{position}", "2"),
    });
    expect(emptied).toHaveFocus();
    expect(screen.getByText(copy.pickOneMore)).toBeInTheDocument();
  });

  it("slides up with motion-safe motion only", async () => {
    const { user } = renderOnPhone();

    await pickIceCubes(user);
    const dialog = await sheet();

    expect(tokens(dialog)).toContain("motion-safe:animate-sheet-up");
    expect(
      tokens(dialog).filter((token) => token.startsWith("animate-")),
    ).toEqual([]);
  });
});

describe("the claim sheet, on a wider screen", () => {
  it("never opens: step 2 holds the claim form inline instead", async () => {
    restoreViewport();
    restoreViewport = emulateViewport("wide");
    const { user } = renderOnPhone();

    await pickIceCubes(user);
    await screen.findByText(copy.stateAvailable);

    expect(screen.queryByRole("dialog")).toBeNull();
    // The bar's Claim button is the phone's way back to the sheet (#272).
    expect(barClaim()).toBeNull();
    const step = composer().querySelector("[data-claim-step]");
    expect(step).toHaveAttribute("data-claim-step", "open");
    expect(
      within(step as HTMLElement).getByRole("form", {
        name: claimCopy.claimHeading,
      }),
    ).toBeInTheDocument();
  });
});
