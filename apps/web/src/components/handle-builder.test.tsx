import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { AvailabilityState } from "./availability-state";
import type { ClaimFormState } from "./claim-action";
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
  initialEmoji?: readonly string[],
) {
  const user = userEvent.setup();
  render(
    <HandleBuilder
      checkAvailability={checkAvailability}
      initialEmoji={initialEmoji}
    />,
  );
  return { user, checkAvailability };
}

describe("the builder opened on a Handle already picked", () => {
  /**
   * What `/[handle]` does with an unclaimed Handle
   * ([#105](https://github.com/joshstothard/3moji/issues/105)): the same
   * builder, handed the three emoji from the path. One optional prop rather
   * than a second builder, so the focus behaviour above cannot drift apart
   * between the two surfaces.
   */
  it("opens with those emoji in the slots, in order", async () => {
    renderBuilder(undefined, [ICE, "\u{1F355}", ICE]);

    expect(filledSlot(1, "ice cube")).toBeInTheDocument();
    expect(filledSlot(2, "pizza")).toBeInTheDocument();
    expect(filledSlot(3, "ice cube")).toBeInTheDocument();
    // A full Handle is asked about on mount; let the answer land inside the
    // test rather than after it.
    await screen.findByText(copy.stateAvailable);
  });

  it("asks about that Handle straight away, with no pick to wait for", async () => {
    const checkAvailability = jest.fn((_segment: string) =>
      Promise.resolve("available" as const),
    );

    renderBuilder(checkAvailability, [ICE, ICE, ICE]);

    await waitFor(() => {
      expect(checkAvailability).toHaveBeenCalledWith(ENCODED_ICE_TRIPLE);
    });
    expect(await screen.findByText(copy.stateAvailable)).toBeInTheDocument();
  });

  it("still clears a slot to an empty one, exactly as a picked slot does", async () => {
    const { user } = renderBuilder(undefined, [ICE, ICE, ICE]);
    // The pre-filled builder asks about the Handle on mount, so let that answer
    // land before clicking: what is being asserted is the clear, not a race.
    await screen.findByText(copy.stateAvailable);

    await user.click(filledSlot(2, "ice cube"));

    expect(slot(2)).toBeInTheDocument();
  });
});

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

/**
 * Claiming, from the builder ([#115](https://github.com/joshstothard/3moji/issues/115)).
 *
 * The claim is a server action, injected as a prop for the reason the
 * availability read is. The form itself has its own suite; what belongs here is
 * **when** the builder offers it and **which Handle** it carries — the one in
 * the slots now, not the one the page opened on.
 */
describe("claiming from the builder", () => {
  const claimCopy = en.Claim;
  const PIZZA = "\u{1F355}";

  const claim = jest.fn(
    (_previous: ClaimFormState, _formData: FormData) =>
      new Promise<ClaimFormState>(() => undefined),
  );

  function renderClaimable(
    checkAvailability: (segment: string) => Promise<AvailabilityState>,
    initialEmoji?: readonly string[],
    initialAvailability?: AvailabilityState,
  ) {
    const user = userEvent.setup();
    render(
      <HandleBuilder
        checkAvailability={checkAvailability}
        claim={claim}
        initialAvailability={initialAvailability}
        initialEmoji={initialEmoji}
      />,
    );
    return user;
  }

  const claimForm = () =>
    screen.queryByRole("form", { name: claimCopy.claimHeading });

  const claimedHandle = () =>
    document.querySelector<HTMLInputElement>('form input[name="handle"]')
      ?.value;

  it("offers the claim form once the Handle is available, carrying that Handle", async () => {
    const user = renderClaimable(() => Promise.resolve("available"));

    await pick(user, "ice cube", "ice cube", "ice cube");
    await screen.findByText(copy.stateAvailable);

    expect(claimForm()).toBeInTheDocument();
    expect(claimedHandle()).toBe(ENCODED_ICE_TRIPLE);
  });

  it("offers no claim before three slots are filled", async () => {
    const user = renderClaimable(() => Promise.resolve("available"));

    await pick(user, "ice cube", "ice cube");

    expect(claimForm()).not.toBeInTheDocument();
  });

  it.each([
    ["held", copy.stateHeld],
    ["claimed", copy.stateClaimed],
    ["not-claimable", copy.stateNotClaimable],
    ["not-a-handle", copy.stateNotAHandle],
    ["unknown", copy.stateUnknown],
  ] as const)("offers no claim for a %s Handle", async (state, text) => {
    // Reserved can never be claimed, and unknown means the read failed: an
    // invitation there would be issued on no evidence (#68).
    const user = renderClaimable(() => Promise.resolve(state));

    await pick(user, "ice cube", "ice cube", "ice cube");
    await screen.findByText(text);

    expect(claimForm()).not.toBeInTheDocument();
  });

  it("offers no claim while the answer is still being checked", async () => {
    const user = renderClaimable(() => new Promise(() => undefined));

    await pick(user, "ice cube", "ice cube", "ice cube");
    await screen.findByText(copy.checking);

    expect(claimForm()).not.toBeInTheDocument();
  });

  it("withdraws the claim the moment the Handle changes", async () => {
    const user = renderClaimable(
      () => Promise.resolve("available"),
      [ICE, ICE, ICE],
    );
    await screen.findByText(copy.stateAvailable);

    await user.click(filledSlot(3, "ice cube"));

    expect(claimForm()).not.toBeInTheDocument();
  });

  it("claims the Handle now in the slots, not the one it opened on", async () => {
    const user = renderClaimable(
      () => Promise.resolve("available"),
      [ICE, ICE, ICE],
    );
    await screen.findByText(copy.stateAvailable);

    await user.click(filledSlot(3, "ice cube"));
    await pick(user, "pizza");
    await screen.findByText(copy.stateAvailable);

    expect(claimedHandle()).toBe(encodeURIComponent(`${ICE}${ICE}${PIZZA}`));
  });

  it("offers the claim on first paint when the page has already read the Handle as available", () => {
    // `/[handle]` has just read the answer that put the builder on the page;
    // making the visitor wait for the same read again before the call to action
    // has anything to point at would be a flash of nothing.
    renderClaimable(
      () => new Promise(() => undefined),
      [ICE, ICE, ICE],
      "available",
    );

    expect(claimForm()).toBeInTheDocument();
    expect(claimedHandle()).toBe(ENCODED_ICE_TRIPLE);
  });
});

/**
 * A rare three-of-a-kind ([#202](https://github.com/joshstothard/3moji/issues/202)).
 *
 * Three of the same emoji stay claimable, and finding one free is meant to feel
 * special. The celebration is **derived from two things the builder already
 * shows** — the three slots and the availability line — so it can reveal
 * nothing new: it appears only when the slots match and the line reads
 * available, and for every other answer about the same triple it stays away.
 *
 * jsdom evaluates no CSS, so the motion itself and its reduced-motion
 * alternative are proved in `e2e/rare-handle.spec.ts`. What is proved here is
 * when it appears, what is announced, and that focus never moves.
 */
describe("a rare three-of-a-kind Handle", () => {
  const PIZZA = "\u{1F355}";

  function rareBadge(): HTMLElement | null {
    return screen.queryByText(copy.rareBadge);
  }

  function announcement(): HTMLElement | null {
    return screen.queryByText(copy.rareAnnouncement);
  }

  /** The polite live region the rarity is announced through. */
  function rareRegion(): HTMLElement {
    const region = document.querySelector<HTMLElement>(
      "[data-rare-announcement]",
    );
    if (region === null) throw new Error("no rare live region is rendered");
    return region;
  }

  it("celebrates an available three-of-a-kind with a badge and an announcement", async () => {
    const { user } = renderBuilder(() => Promise.resolve("available"));

    await pick(user, "ice cube", "ice cube", "ice cube");
    await screen.findByText(copy.stateAvailable);

    expect(rareBadge()).toBeInTheDocument();
    expect(announcement()).toBeInTheDocument();
  });

  it("celebrates on first paint when the page opened on an available three-of-a-kind", () => {
    render(
      <HandleBuilder
        checkAvailability={() => new Promise(() => undefined)}
        initialEmoji={[ICE, ICE, ICE]}
        initialAvailability="available"
      />,
    );

    expect(rareBadge()).toBeInTheDocument();
  });

  it.each([
    ["claimed", copy.stateClaimed],
    ["held", copy.stateHeld],
    ["not-claimable", copy.stateNotClaimable],
    ["not-a-handle", copy.stateNotAHandle],
    ["unknown", copy.stateUnknown],
  ] as const)(
    "does not celebrate a three-of-a-kind that comes back %s",
    async (state, text) => {
      const { user } = renderBuilder(() => Promise.resolve(state));

      await pick(user, "ice cube", "ice cube", "ice cube");
      await screen.findByText(text);

      expect(rareBadge()).not.toBeInTheDocument();
      expect(announcement()).not.toBeInTheDocument();
    },
  );

  it("does not celebrate while the three-of-a-kind is still being checked", async () => {
    const { user } = renderBuilder(() => new Promise(() => undefined));

    await pick(user, "ice cube", "ice cube", "ice cube");
    await screen.findByText(copy.checking);

    expect(rareBadge()).not.toBeInTheDocument();
    expect(announcement()).not.toBeInTheDocument();
  });

  it("does not celebrate two of a kind", async () => {
    const { user } = renderBuilder(() => Promise.resolve("available"));

    await pick(user, "ice cube", "ice cube");

    expect(rareBadge()).not.toBeInTheDocument();
  });

  it.each([
    ["the last differs", [ICE, ICE, PIZZA]],
    ["the middle differs", [ICE, PIZZA, ICE]],
    ["the first differs", [PIZZA, ICE, ICE]],
  ] as const)(
    "does not celebrate an available Handle whose emoji do not all match: %s",
    async (_name, initialEmoji) => {
      renderBuilder(() => Promise.resolve("available"), initialEmoji);

      await screen.findByText(copy.stateAvailable);

      expect(rareBadge()).not.toBeInTheDocument();
      expect(announcement()).not.toBeInTheDocument();
    },
  );

  it("announces through a polite live region that is on the page before the Handle is", async () => {
    // A live region inserted together with its text is not reliably announced,
    // so the region is permanent and only its text changes.
    const { user } = renderBuilder(() => Promise.resolve("available"));
    const region = rareRegion();
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("");

    await pick(user, "ice cube", "ice cube", "ice cube");
    await screen.findByText(copy.stateAvailable);

    expect(rareRegion()).toBe(region);
    expect(region).toHaveTextContent(copy.rareAnnouncement);
    // Announced once: the visible badge is hidden from assistive technology,
    // so the sentence is not read a second time from the badge.
    expect(rareBadge()?.closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("does not announce again when the builder re-renders for an unrelated reason", async () => {
    const view = render(
      <HandleBuilder
        checkAvailability={() => Promise.resolve("available")}
        initialEmoji={[ICE, ICE, ICE]}
      />,
    );
    await screen.findByText(copy.rareAnnouncement);
    const region = rareRegion();
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => {
      mutations.push(...records);
    });
    observer.observe(region, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    // A new read function asks about the same Handle again and gets the same
    // answer: a re-render in which nothing about the rarity has changed.
    const reread = jest.fn((_segment: string) =>
      Promise.resolve("available" as const),
    );
    view.rerender(
      <HandleBuilder
        checkAvailability={reread}
        initialEmoji={[ICE, ICE, ICE]}
      />,
    );
    await waitFor(() => {
      expect(reread).toHaveBeenCalled();
    });
    await screen.findByText(copy.stateAvailable);
    observer.disconnect();

    expect(mutations).toEqual([]);
    expect(region).toHaveTextContent(copy.rareAnnouncement);
  });

  it("does not move focus when the celebration appears", async () => {
    const { user } = renderBuilder(() => Promise.resolve("available"));
    await pick(user, "ice cube", "ice cube");

    const button = emoji("ice cube");
    button.focus();
    await user.keyboard("{Enter}");
    await screen.findByText(copy.rareAnnouncement);

    expect(button).toHaveFocus();
  });

  it("withdraws the celebration when the Handle changes, and plays it afresh on the way back", async () => {
    const { user } = renderBuilder(() => Promise.resolve("available"));
    await pick(user, "ice cube", "ice cube", "ice cube");
    await screen.findByText(copy.stateAvailable);
    const first = rareBadge();
    expect(first).toBeInTheDocument();

    await user.click(filledSlot(3, "ice cube"));
    expect(rareBadge()).not.toBeInTheDocument();
    expect(rareRegion()).toHaveTextContent("");

    await pick(user, "ice cube");
    await screen.findByText(copy.stateAvailable);

    // A new node, not the old one kept: a CSS animation plays when its element
    // is inserted, so a fresh node is what replays it.
    const second = rareBadge();
    expect(second).toBeInTheDocument();
    expect(second).not.toBe(first);
  });
});
