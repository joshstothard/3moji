import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { curatedEmojiSet } from "@template/core/browser";
import { EmojiPicker } from "./emoji-picker";

/**
 * The picker runs against the real Emoji Set, not a stub.
 *
 * `@template/core/browser` is mapped to source in `jest.config.mjs` and reaches
 * no infrastructure, so there is nothing to mock and nothing gained by it: the
 * behaviour worth asserting is that a released emoji is offered under its
 * curated display name, which a fixture of two entries would not prove.
 */
const ICE = "\u{1F9CA}";
const PIZZA = "\u{1F355}";

describe("the emoji picker", () => {
  it("offers every released emoji as a button, and nothing else", () => {
    render(<EmojiPicker onPick={jest.fn()} full={false} />);

    expect(screen.getAllByRole("button")).toHaveLength(curatedEmojiSet.length);
  });

  it("names each button by its curated display name, not by its code point", () => {
    render(<EmojiPicker onPick={jest.fn()} full={false} />);

    expect(
      screen.getByRole("button", { name: "ice cube" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "pizza" })).toBeInTheDocument();
  });

  it("hides the glyph itself from assistive technology, so the name is read once", () => {
    render(<EmojiPicker onPick={jest.fn()} full={false} />);

    const button = screen.getByRole("button", { name: "ice cube" });

    expect(button).toHaveTextContent(ICE);
    expect(button.querySelector("[aria-hidden='true']")).toHaveTextContent(ICE);
  });

  it("reports the code point of the emoji that was picked", async () => {
    const onPick = jest.fn();
    const user = userEvent.setup();
    render(<EmojiPicker onPick={onPick} full={false} />);

    await user.click(screen.getByRole("button", { name: "pizza" }));

    expect(onPick).toHaveBeenCalledWith(PIZZA);
  });

  it("marks its buttons aria-disabled when the Handle is full, and stays picky about nothing else", () => {
    render(<EmojiPicker onPick={jest.fn()} full />);

    const button = screen.getByRole("button", { name: "ice cube" });

    // aria-disabled rather than `disabled`: a disabled button is removed from
    // the tab order, and a full Handle must not throw away the focus of
    // whoever is standing on it (WCAG 2.4.3, and #78's focus criterion).
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
  });

  it("does not report a pick once the Handle is full", async () => {
    const onPick = jest.fn();
    const user = userEvent.setup();
    render(<EmojiPicker onPick={onPick} full />);

    await user.click(screen.getByRole("button", { name: "ice cube" }));

    expect(onPick).not.toHaveBeenCalled();
  });
});
