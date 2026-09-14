import { act, render, screen } from "@testing-library/react";
import type { AvailabilityState } from "./availability-state";
import type { ClaimFormState } from "./claim-action";
import { HandleBuilder } from "./handle-builder";
import { checkAccessibility } from "../test-support/axe";
import en from "../../../../packages/shared/messages/en.json";

/**
 * The Handle builder in every availability state, checked by axe for WCAG 2 A
 * and AA ([#152](https://github.com/joshstothard/3moji/issues/152)).
 *
 * Driven as `handle-builder.test.tsx` drives it: the real Emoji Set, and the
 * availability read injected as a prop. It opens on 🍕🍕🍕, which is what makes
 * the taken states render their swap suggestions — the part of the builder that
 * appears only when a Handle is refused — and the available state its rare
 * three-of-a-kind badge (#202). The claim endpoint is injected too, so the
 * available state carries the claim form it offers on the page.
 */
const PIZZA = "\u{1F355}";
const copy = en.HandleBuilder;

const neverSettles = (_previous: ClaimFormState, _formData: FormData) =>
  new Promise<ClaimFormState>(() => undefined);

async function renderIn(state: AvailabilityState, line: string) {
  let container: HTMLElement | undefined;
  await act(async () => {
    ({ container } = render(
      <HandleBuilder
        checkAvailability={jest.fn(() => Promise.resolve(state))}
        claim={neverSettles}
        initialEmoji={[PIZZA, PIZZA, PIZZA]}
      />,
    ));
    await Promise.resolve();
  });
  await screen.findByText(line);
  if (container === undefined) throw new Error("the builder did not render");
  return container;
}

describe("the Handle builder, checked by axe", () => {
  it("reports no violations with every slot empty", async () => {
    const { container } = render(
      <HandleBuilder checkAvailability={jest.fn()} />,
    );

    const report = await checkAccessibility(container);

    expect(report.violations).toEqual([]);
    expect(report.incomplete).toEqual([]);
    expect(report.passed).toEqual(
      expect.arrayContaining(["button-name", "aria-allowed-attr"]),
    );
  });

  it("reports no violations with one slot filled, its remove marks rendered (#252)", async () => {
    // A partial Handle asks nothing, so no read is needed to settle.
    const { container } = render(
      <HandleBuilder checkAvailability={jest.fn()} initialEmoji={[PIZZA]} />,
    );
    // The filled slot, named by what activating it does, and carrying the X
    // and the Remove label inside it: without them axe would be checking the
    // same markup as the empty case above.
    const filled = screen.getByRole("button", {
      name: "Remove pizza from slot 1",
    });
    expect(filled.querySelectorAll("svg").length).toBeGreaterThanOrEqual(2);

    const report = await checkAccessibility(container);

    expect(report.violations).toEqual([]);
    expect(report.incomplete).toEqual([]);
    expect(report.passed).toEqual(
      expect.arrayContaining(["button-name", "aria-allowed-attr"]),
    );
  });

  it("reports no violations with step 2 locked, waiting for three emoji (#263)", async () => {
    const { container } = render(
      <HandleBuilder checkAvailability={jest.fn()} claim={neverSettles} />,
    );
    // Without the locked step rendered, axe would be checking the builder
    // exactly as the first case does.
    expect(
      container.querySelector('[data-claim-step="locked"]'),
    ).not.toBeNull();

    const report = await checkAccessibility(container);

    expect(report.violations).toEqual([]);
    expect(report.incomplete).toEqual([]);
    expect(report.passed).toEqual(
      expect.arrayContaining(["button-name", "aria-allowed-attr"]),
    );
  });

  /*
   * The phone's claim sheet is not checked here, and cannot be. With any
   * `dialog[open]` in the document, axe decides whether it is modal by hit
   * testing with `document.elementsFromPoint`, which jsdom does not implement,
   * so every rule reports "Axe encountered an error" whatever the markup.
   * Faking the hit test would be axe judging a page layout that does not
   * exist. The open sheet is checked by axe in Chromium instead, in
   * `e2e/composer.spec.ts`.
   */

  /**
   * Each row also says what makes that state's DOM different — the claim form
   * for an available Handle, three swap suggestions for a refused one — and
   * asserts it rendered before axe runs. Without that, a state whose region
   * failed to render would be checked against the same slots and preview as
   * `unknown`, and pass without having looked at anything of its own.
   */
  it.each([
    [
      "available",
      "available",
      copy.stateAvailable,
      { claimForm: true, swaps: 0, rare: true },
      ["label", "button-name", "autocomplete-valid"],
    ],
    [
      "taken",
      "claimed",
      copy.stateClaimed,
      { claimForm: false, swaps: 3, rare: false },
      ["button-name", "role-img-alt"],
    ],
    [
      "on hold",
      "held",
      copy.stateHeld,
      { claimForm: false, swaps: 3, rare: false },
      ["button-name", "role-img-alt"],
    ],
    [
      "reserved",
      "not-claimable",
      copy.stateNotClaimable,
      { claimForm: false, swaps: 3, rare: false },
      ["button-name", "role-img-alt"],
    ],
    [
      "unknown",
      "unknown",
      copy.stateUnknown,
      { claimForm: false, swaps: 0, rare: false },
      ["button-name", "role-img-alt"],
    ],
  ] as const)(
    "reports no violations when the Handle is %s",
    async (_name, state: AvailabilityState, line, region, evaluated) => {
      const container = await renderIn(state, line);

      expect(screen.queryAllByRole("button", { name: /^Use / })).toHaveLength(
        region.swaps,
      );
      expect(
        screen.queryByRole("form", { name: en.Claim.claimHeading }) !== null,
      ).toBe(region.claimForm);
      // 🍕🍕🍕 is three of a kind, so an available answer celebrates it as
      // rare (#202) and axe sees the badge and its live region; no other
      // answer does.
      expect(screen.queryByText(copy.rareBadge) !== null).toBe(region.rare);

      const report = await checkAccessibility(container);

      expect(report.violations).toEqual([]);
      expect(report.incomplete).toEqual([]);
      expect(report.passed).toEqual(expect.arrayContaining([...evaluated]));
    },
  );
});
