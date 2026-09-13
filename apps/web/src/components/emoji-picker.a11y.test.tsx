import { render, screen } from "@testing-library/react";
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
  it("reports no violations as it opens, and evaluates its buttons, list and label", async () => {
    const { container } = render(
      <EmojiPicker onPick={jest.fn()} full={false} />,
    );

    const report = await checkAccessibility(container);

    expect(report.violations).toEqual([]);
    expect(report.incomplete).toEqual([]);
    expect(report.passed).toEqual(
      expect.arrayContaining(["button-name", "label", "list", "listitem"]),
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

  it("reports no violations when a search finds nothing", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <EmojiPicker onPick={jest.fn()} full={false} />,
    );

    await user.click(screen.getByLabelText(copy.pickerSearchLabel));
    await user.keyboard("zzzz");
    await screen.findByText(copy.pickerNoMatches.replace("{query}", "zzzz"));

    const report = await checkAccessibility(container);

    expect(report.violations).toEqual([]);
    expect(report.incomplete).toEqual([]);
    expect(report.passed).toEqual(expect.arrayContaining(["label"]));
  });
});
