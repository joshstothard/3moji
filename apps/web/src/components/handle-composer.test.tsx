import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import type { AvailabilityState } from "./availability-state";
import type { ClaimFormState } from "./claim-action";
import { HandleBuilder } from "./handle-builder";
import en from "../../../../packages/shared/messages/en.json";

/**
 * The composer: the builder, the picker and the claim form connected into one
 * card ([#263](https://github.com/joshstothard/3moji/issues/263)).
 *
 * The owner chose the "one composer card" layout for a wide screen and the two
 * phone artboards. The markup is one tree at every width, repositioned by CSS,
 * so these tests drive the real builder and assert what the tree holds and in
 * what order. jsdom evaluates no CSS, so where stickiness is the behaviour the
 * classes are pinned, and `e2e/composer.spec.ts` measures the rendered page.
 * The phone's claim sheet is `claim-sheet.test.tsx`.
 */
const ICE = "\u{1F9CA}";
const PIZZA = "\u{1F355}";
const copy = en.HandleBuilder;
const claimCopy = en.Claim;

const neverSettles = (_previous: ClaimFormState, _formData: FormData) =>
  new Promise<ClaimFormState>(() => undefined);

function tokens(element: Element): readonly string[] {
  return (element.getAttribute("class") ?? "").split(/\s+/);
}

function renderComposer(
  state: AvailabilityState = "available",
  {
    claim = true,
    initialEmoji,
  }: {
    readonly claim?: boolean;
    readonly initialEmoji?: readonly string[];
  } = {},
) {
  const user = userEvent.setup();
  const { container } = render(
    <HandleBuilder
      checkAvailability={jest.fn(() => Promise.resolve(state))}
      {...(claim ? { claim: neverSettles } : {})}
      {...(initialEmoji === undefined ? {} : { initialEmoji })}
    />,
  );
  return { user, container };
}

async function pick(user: UserEvent, ...names: readonly string[]) {
  for (const name of names) {
    await user.click(screen.getByRole("button", { name }));
  }
}

function composer(): HTMLElement {
  return screen.getByRole("region", { name: copy.builderHeading });
}

function claimStep(): HTMLElement {
  const step = composer().querySelector<HTMLElement>("[data-claim-step]");
  if (step === null) throw new Error("the composer has no step 2");
  return step;
}

function follows(earlier: Element, later: Element): boolean {
  return Boolean(
    earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("the composer (#263)", () => {
  it("holds the slots, the category tabs, the grid and step 2 in one card, in that order", () => {
    renderComposer();
    const card = composer();

    const slots = within(card).getByRole("group", { name: copy.slotsLabel });
    const tabs = within(card).getByRole("group", {
      name: copy.pickerCategoriesLabel,
    });
    const grid = within(card).getByRole("list");
    const step = claimStep();

    expect(follows(slots, tabs)).toBe(true);
    expect(follows(tabs, grid)).toBe(true);
    expect(follows(grid, step)).toBe(true);
  });

  it("keeps the slot row sticky under the header: a bar on a phone, within the card from md", () => {
    renderComposer();

    const slots = screen.getByRole("group", { name: copy.slotsLabel });
    const bar = slots.closest("[data-composer-bar]");
    if (bar === null) throw new Error("the slots are not in the composer bar");

    // The spoken line rides in the bar with the slots, on every width.
    expect(
      within(bar as HTMLElement).getByText(copy.spokenEmpty),
    ).toBeVisible();
    expect(tokens(bar)).toEqual(
      expect.arrayContaining([
        "sticky",
        // Under the 4rem phone header and the 5rem one from `sm`, overlapping
        // it by a pixel so no sliver of the page shows between the two.
        "top-[calc(4rem-1px)]",
        "sm:top-[calc(5rem-1px)]",
        "md:top-20",
      ]),
    );
  });

  it("sticks the category tabs under the bar on a phone only", () => {
    renderComposer();

    const tabs = screen.getByRole("group", {
      name: copy.pickerCategoriesLabel,
    });
    const row = tabs.closest("[data-picker-tabs]");
    if (row === null) throw new Error("the tabs have no row of their own");

    expect(tokens(row)).toContain("max-md:sticky");
    expect(tokens(row).some((token) => token.startsWith("max-md:top-"))).toBe(
      true,
    );
    expect(tokens(row)).not.toContain("sticky");
  });

  it("says how many emoji are still to pick, and stops once the Handle is complete", async () => {
    const { user } = renderComposer();

    await pick(user, "ice cube");
    expect(screen.getByText(copy.pickTwoMore)).toBeInTheDocument();

    await pick(user, "pizza");
    expect(screen.getByText(copy.pickOneMore)).toBeInTheDocument();
    expect(screen.queryByText(copy.pickTwoMore)).not.toBeInTheDocument();

    await pick(user, "ice cube");
    await screen.findByText(copy.stateAvailable);
    expect(screen.queryByText(copy.pickOneMore)).not.toBeInTheDocument();
  });

  describe("step 2, Make it yours", () => {
    it("is locked, and holds no form, until all three emoji are picked", async () => {
      const { user } = renderComposer();

      expect(claimStep()).toHaveAttribute("data-claim-step", "locked");
      expect(within(claimStep()).getByText(copy.stepLocked)).toBeVisible();
      expect(document.querySelectorAll("form")).toHaveLength(0);

      await pick(user, "ice cube", "pizza");

      expect(claimStep()).toHaveAttribute("data-claim-step", "locked");
      expect(document.querySelectorAll("form")).toHaveLength(0);
    });

    it.each([
      ["claimed", copy.stateClaimed],
      ["held", copy.stateHeld],
      ["not-claimable", copy.stateNotClaimable],
      ["unknown", copy.stateUnknown],
    ] as const)(
      "stays locked when the complete Handle comes back %s",
      async (state, line) => {
        const { user } = renderComposer(state);

        await pick(user, "pizza", "pizza", "ice cube");
        await screen.findByText(line);

        expect(claimStep()).toHaveAttribute("data-claim-step", "locked");
        expect(document.querySelectorAll("form")).toHaveLength(0);
      },
    );

    it("opens with the claim form once the Handle is available", async () => {
      const { user } = renderComposer("available");

      await pick(user, "ice cube", "pizza", "ice cube");

      await waitFor(() => {
        expect(claimStep()).toHaveAttribute("data-claim-step", "open");
      });
      expect(
        within(claimStep()).getByRole("form", { name: claimCopy.claimHeading }),
      ).toBeInTheDocument();
      expect(within(claimStep()).queryByText(copy.stepLocked)).toBeNull();
    });

    it("unlocks with motion-safe motion only", async () => {
      const { user } = renderComposer("available");

      await pick(user, "ice cube", "pizza", "ice cube");
      await waitFor(() => {
        expect(claimStep()).toHaveAttribute("data-claim-step", "open");
      });

      const animated = Array.from(claimStep().querySelectorAll("*"))
        .concat(claimStep())
        .flatMap((element) => tokens(element));
      expect(animated).toContain("motion-safe:animate-step-unlock");
      expect(animated.filter((token) => token.startsWith("animate-"))).toEqual(
        [],
      );
    });

    it("does not play the unlock for the Handle the page opened on, which is open from the first paint", async () => {
      // `/[handle]` renders an unclaimed Handle with step 2 already open, and
      // without JavaScript. Nothing unlocked there, so nothing moves; and a
      // CSS animation on the form's wrapper kept Playwright from ever
      // judging the no-JS submit button stable.
      render(
        <HandleBuilder
          checkAvailability={jest.fn(() =>
            Promise.resolve("available" as const),
          )}
          claim={neverSettles}
          initialAvailability="available"
          initialEmoji={[ICE, PIZZA, ICE]}
        />,
      );
      await screen.findByText(copy.stateAvailable);

      expect(claimStep()).toHaveAttribute("data-claim-step", "open");
      const animated = Array.from(claimStep().querySelectorAll("*"))
        .concat(claimStep())
        .flatMap((element) => tokens(element));
      expect(animated).not.toContain("motion-safe:animate-step-unlock");
    });

    it("is not offered at all without a claim endpoint", () => {
      renderComposer("available", { claim: false });

      expect(composer().querySelector("[data-claim-step]")).toBeNull();
    });
  });

  it("renders the claim form inline on the server, so it works without JavaScript, and no sheet", () => {
    // What `/[handle]` sends for an unclaimed Handle before any script runs:
    // the form is in step 2, in the page, and there is no dialog to open.
    const html = renderToString(
      <HandleBuilder
        checkAvailability={jest.fn(() => Promise.resolve("available" as const))}
        claim={neverSettles}
        initialAvailability="available"
        initialEmoji={[ICE, PIZZA, ICE]}
      />,
    );

    expect(html).toContain('data-claim-step="open"');
    expect(html).toContain('id="claim-email"');
    expect(html).not.toContain("<dialog");
  });

  it("staggers the rare hop with classes, never an inline style (#267)", async () => {
    const { container } = renderComposer("available", {
      initialEmoji: [ICE, ICE, ICE],
    });
    await screen.findByText(copy.rareBadge);

    expect(container.querySelectorAll("[style]")).toHaveLength(0);
    const glyphs = Array.from(
      composer().querySelectorAll("[data-composer-bar] [data-slot-glyph]"),
    );
    expect(
      glyphs.map((glyph) =>
        tokens(glyph).find((token) => token.startsWith("motion-safe:animate-")),
      ),
    ).toEqual([
      "motion-safe:animate-rare-hop",
      "motion-safe:animate-rare-hop-2",
      "motion-safe:animate-rare-hop-3",
    ]);
  });
});
