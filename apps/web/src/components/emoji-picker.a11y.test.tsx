import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmojiPicker } from "./emoji-picker";
import { checkAccessibility } from "../test-support/axe";
import en from "../../../../packages/shared/messages/en.json";

/**
 * The emoji picker, checked by axe for WCAG 2 A and AA
 * ([#152](https://github.com/joshstothard/3moji/issues/152)).
 *
 * Rendered exactly as `emoji-picker.test.tsx` renders it, against the real
 * Emoji Set. What jsdom cannot evaluate is listed in `test-support/axe.ts`.
 */
const copy = en.HandleBuilder;

describe("the emoji picker, checked by axe", () => {
  it("reports no violations as it opens, and evaluates its buttons and list", async () => {
    const { container } = render(
      <EmojiPicker onPick={jest.fn()} full={false} />,
    );

    const report = await checkAccessibility(container);

    expect(report.violations).toEqual([]);
    expect(report.incomplete).toEqual([]);
    expect(report.passed).toEqual(
      expect.arrayContaining(["button-name", "list", "listitem"]),
    );
  });

  it("reports no violations once the Handle is full", async () => {
    const { container } = render(<EmojiPicker onPick={jest.fn()} full />);

    const report = await checkAccessibility(container);

    expect(report.violations).toEqual([]);
    expect(report.incomplete).toEqual([]);
    expect(report.passed).toEqual(
      expect.arrayContaining(["button-name", "aria-allowed-attr"]),
    );
  });

  it("reports no violations after another category's tab is picked", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <EmojiPicker onPick={jest.fn()} full={false} />,
    );

    await user.click(
      within(
        screen.getByRole("group", { name: copy.pickerCategoriesLabel }),
      ).getByRole("button", { name: "Activities" }),
    );
    await screen.findByRole("button", { name: "soccer ball" });

    const report = await checkAccessibility(container);

    expect(report.violations).toEqual([]);
    expect(report.incomplete).toEqual([]);
    expect(report.passed).toEqual(
      expect.arrayContaining(["button-name", "aria-allowed-attr", "list"]),
    );
  });
});
