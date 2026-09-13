import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ShareLinkControl } from "./share-link";
import { checkAccessibility } from "../test-support/axe";
import en from "../../../../packages/shared/messages/en.json";

/**
 * The share control idle, after a copy and after a failed copy, checked by axe
 * for WCAG 2 A and AA ([#152](https://github.com/joshstothard/3moji/issues/152),
 * [#160](https://github.com/joshstothard/3moji/issues/160)).
 *
 * The failure state is the one worth checking: it is when a text field appears,
 * and an unlabelled field is exactly how a manual-copy fallback usually fails.
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

describe("the share control, checked by axe", () => {
  it("reports no violations while idle", async () => {
    const { container } = render(<ShareLinkControl href={HREF} />);

    const report = await checkAccessibility(container);

    expect(report.violations).toEqual([]);
    expect(report.incomplete).toEqual([]);
    expect(report.passed).toEqual(expect.arrayContaining(["button-name"]));
  });

  it("reports no violations after a successful copy", async () => {
    const user = userEvent.setup();
    setClipboard({ writeText: () => Promise.resolve() });
    const { container } = render(<ShareLinkControl href={HREF} />);

    await user.click(screen.getByRole("button", { name: copy.shareCopy }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(copy.shareCopied);
    });

    const report = await checkAccessibility(container);

    expect(report.violations).toEqual([]);
    expect(report.incomplete).toEqual([]);
    expect(report.passed).toEqual(expect.arrayContaining(["button-name"]));
  });

  it("reports no violations with the manual-copy field shown", async () => {
    const user = userEvent.setup();
    setClipboard(undefined);
    const { container } = render(<ShareLinkControl href={HREF} />);

    await user.click(screen.getByRole("button", { name: copy.shareCopy }));
    await waitFor(() => {
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    const report = await checkAccessibility(container);

    expect(report.violations).toEqual([]);
    expect(report.incomplete).toEqual([]);
    expect(report.passed).toEqual(
      expect.arrayContaining(["button-name", "label"]),
    );
  });
});
