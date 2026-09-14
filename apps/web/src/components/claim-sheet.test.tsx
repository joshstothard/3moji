import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
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
    expect(composer().querySelector("[data-claim-step]")).toBeNull();
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

  it("closes on Escape and puts focus back on the slot bar", async () => {
    const { user } = renderOnPhone();

    await pickIceCubes(user);
    const dialog = await sheet();
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(dialog).not.toHaveAttribute("open");
    });
    expect(composer()).not.toHaveAttribute("inert");
    expect(
      within(barSlots()).getByRole("button", { name: slotName(3, "ice cube") }),
    ).toHaveFocus();
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
    expect(
      within(barSlots()).getByRole("button", { name: slotName(3, "ice cube") }),
    ).toHaveFocus();
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
    const step = composer().querySelector("[data-claim-step]");
    expect(step).toHaveAttribute("data-claim-step", "open");
    expect(
      within(step as HTMLElement).getByRole("form", {
        name: claimCopy.claimHeading,
      }),
    ).toBeInTheDocument();
  });
});
