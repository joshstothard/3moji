import { render, screen } from "@testing-library/react";

import { HandleLookup } from "./handle-lookup";
import en from "../../../../packages/shared/messages/en.json";

/**
 * The "Find a Handle" lookup (#200).
 *
 * **A plain GET form is the whole mechanism**, so these tests pin the form's
 * attributes rather than a click handler: with JavaScript disabled, the browser
 * itself submits `/find?q=…`, and nothing else would work.
 */
const copy = en.HandleLookup;

describe("HandleLookup", () => {
  it("is a search landmark named by its heading", () => {
    render(<HandleLookup />);

    expect(
      screen.getByRole("heading", { level: 2, name: copy.heading }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("search", { name: copy.heading }),
    ).toBeInTheDocument();
  });

  it("submits the typed words to /find with GET, so it needs no JavaScript", () => {
    render(<HandleLookup />);

    const form = screen.getByRole("search", { name: copy.heading });
    expect(form).toHaveAttribute("action", "/find");
    expect(form).toHaveAttribute("method", "get");

    const field = screen.getByRole("searchbox", { name: copy.label });
    expect(field).toHaveAttribute("name", "q");
    expect(field).toBeRequired();
    expect(screen.getByRole("button", { name: copy.submit })).toHaveAttribute(
      "type",
      "submit",
    );
  });

  it("describes the field with an example of what to type", () => {
    render(<HandleLookup />);

    expect(
      screen.getByRole("searchbox", { name: copy.label }),
    ).toHaveAccessibleDescription(copy.hint);
  });

  it("starts empty, or with the words a visitor already tried", () => {
    const { unmount } = render(<HandleLookup />);
    expect(screen.getByRole("searchbox", { name: copy.label })).toHaveValue("");
    unmount();

    render(<HandleLookup defaultValue="wibble wobble wubble" />);
    expect(screen.getByRole("searchbox", { name: copy.label })).toHaveValue(
      "wibble wobble wubble",
    );
  });
});
