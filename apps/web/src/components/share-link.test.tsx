import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";

import { ShareLinkControl } from "./share-link";
import en from "../../../../packages/shared/messages/en.json";

/**
 * The control that copies a Handle's canonical word alias link
 * ([#160](https://github.com/joshstothard/3moji/issues/160)).
 *
 * `userEvent.setup()` installs its own `navigator.clipboard` stub, so every
 * test replaces it **after** setup with the clipboard the state needs: one that
 * accepts, one that refuses, and none at all.
 */
const copy = en.HandlePage;
const ALIAS = "ice-cube.ice-cube.ice-cube";
const HREF = `https://3moji.me/${ALIAS}`;

function setClipboard(value: Pick<Clipboard, "writeText"> | undefined): void {
  Object.defineProperty(navigator, "clipboard", {
    value,
    configurable: true,
    writable: true,
  });
}

function setup(clipboard: Pick<Clipboard, "writeText"> | undefined): UserEvent {
  const user = userEvent.setup();
  setClipboard(clipboard);
  render(<ShareLinkControl href={HREF} />);
  return user;
}

function accepting() {
  return { writeText: jest.fn((_text: string) => Promise.resolve()) };
}

function refusing() {
  return {
    writeText: jest.fn((_text: string) =>
      Promise.reject(new DOMException("denied", "NotAllowedError")),
    ),
  };
}

function copyButton(): HTMLElement {
  return screen.getByRole("button", { name: copy.shareCopy });
}

describe("the share control", () => {
  it("shows the link, alias and all, as text", () => {
    setup(accepting());

    expect(screen.getByText(HREF)).toBeInTheDocument();
    expect(document.body.textContent).toContain(ALIAS);
  });

  it("never shows the percent-encoded emoji URL", () => {
    setup(accepting());

    expect(document.body.textContent).not.toMatch(/%/);
  });

  it("is a real button", () => {
    setup(accepting());

    expect(copyButton().tagName).toBe("BUTTON");
    expect(copyButton()).toHaveAttribute("type", "button");
  });

  it("has an empty status region from the first render", () => {
    setup(accepting());

    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
    expect(status).toBeEmptyDOMElement();
  });

  it("offers no text field until copying fails", () => {
    setup(accepting());

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("a successful copy", () => {
  it("copies exactly the link, and nothing else", async () => {
    const clipboard = accepting();
    const user = setup(clipboard);

    await user.click(copyButton());

    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(clipboard.writeText).toHaveBeenCalledWith(HREF);
  });

  it("announces the copy through the status region", async () => {
    const user = setup(accepting());

    await user.click(copyButton());

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(copy.shareCopied);
    });
  });

  it("keeps focus on the control after it is pressed", async () => {
    const user = setup(accepting());

    await user.click(copyButton());
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(copy.shareCopied);
    });

    expect(copyButton()).toHaveFocus();
  });

  it.each([
    ["Enter", "{Enter}"],
    ["Space", " "],
  ])("works from the keyboard with %s", async (_name, key) => {
    const clipboard = accepting();
    const user = setup(clipboard);

    await user.tab();
    expect(copyButton()).toHaveFocus();
    await user.keyboard(key);

    await waitFor(() => {
      expect(clipboard.writeText).toHaveBeenCalledWith(HREF);
    });
    expect(screen.getByRole("status")).toHaveTextContent(copy.shareCopied);
    expect(copyButton()).toHaveFocus();
  });
});

type ClipboardOf = () => Pick<Clipboard, "writeText"> | undefined;

const FAILING_CLIPBOARDS: readonly (readonly [string, ClipboardOf])[] = [
  ["refuses", refusing],
  ["is unavailable", () => undefined],
];

describe.each(FAILING_CLIPBOARDS)(
  "when the Clipboard API %s",
  (_name, clipboardOf) => {
    async function pressAndFail(): Promise<void> {
      const user = setup(clipboardOf());
      await user.click(copyButton());
      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(copy.shareManual);
      });
    }

    it("shows the link in a labelled text field for copying by hand", async () => {
      await pressAndFail();

      const field = screen.getByRole("textbox", {
        name: copy.shareManualLabel,
      });
      expect(field).toHaveValue(HREF);
      expect(field).toHaveAttribute("readonly");
    });

    it("selects the whole link, with the field focused so it can be copied at once", async () => {
      await pressAndFail();

      const field = screen.getByRole<HTMLInputElement>("textbox", {
        name: copy.shareManualLabel,
      });
      await waitFor(() => {
        expect(field).toHaveFocus();
      });
      expect(field.selectionStart).toBe(0);
      expect(field.selectionEnd).toBe(HREF.length);
    });

    it("announces that it must be copied by hand, never that it was copied", async () => {
      await pressAndFail();

      expect(screen.getByRole("status")).not.toHaveTextContent(
        copy.shareCopied,
      );
    });
  },
);
