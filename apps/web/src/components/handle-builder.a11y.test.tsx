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
 * appears only when a Handle is refused. The claim endpoint is injected too, so
 * the available state carries the claim form it offers on the page.
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

  it.each([
    ["available", "available", copy.stateAvailable, ["label", "button-name"]],
    ["taken", "claimed", copy.stateClaimed, ["button-name", "role-img-alt"]],
    ["on hold", "held", copy.stateHeld, ["button-name", "role-img-alt"]],
    [
      "reserved",
      "not-claimable",
      copy.stateNotClaimable,
      ["button-name", "role-img-alt"],
    ],
    ["unknown", "unknown", copy.stateUnknown, ["button-name", "role-img-alt"]],
  ] as const)(
    "reports no violations when the Handle is %s",
    async (_name, state: AvailabilityState, line, evaluated) => {
      const container = await renderIn(state, line);

      const report = await checkAccessibility(container);

      expect(report.violations).toEqual([]);
      expect(report.incomplete).toEqual([]);
      expect(report.passed).toEqual(expect.arrayContaining([...evaluated]));
    },
  );
});
