import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { checkAccessibility } from "../test-support/axe";
import en from "../../../../packages/shared/messages/en.json";

/**
 * The signed-in indicator in each state it renders, checked by axe for WCAG 2
 * A and AA ([#152](https://github.com/joshstothard/3moji/issues/152),
 * [#193](https://github.com/joshstothard/3moji/issues/193)).
 *
 * The open disclosure is the state worth checking: it is where a toggle has to
 * name itself, say whether it is expanded, and point at what it controls.
 * Colour contrast, focus visibility and target size need a real browser and
 * are checked in `e2e/signed-in-state.spec.ts`.
 */
const copy = en.AccountMenu;
const ICE = "\u{1F9CA}\u{1F9CA}\u{1F9CA}";
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";

jest.mock("next/navigation", () => ({
  usePathname: () => "/",
  redirect: jest.fn(),
  notFound: jest.fn(),
}));

// The sign-out server action (#194): rendered as a form here, never run.
jest.mock("./sign-out-action", () => ({
  signOutFormAction: (): Promise<void> => Promise.resolve(),
}));

import { AccountMenu } from "./account-menu";

function answering(body: unknown): void {
  Object.defineProperty(globalThis, "fetch", {
    value: jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(body) }),
    ),
    writable: true,
    configurable: true,
  });
}

describe("the signed-in indicator, checked by axe", () => {
  it("reports no violations for a signed-out visitor", async () => {
    answering({ state: "signed-out" });
    const { container } = render(<AccountMenu />);
    await screen.findByRole("link", { name: copy.signIn });

    const report = await checkAccessibility(container);

    expect(report.violations).toEqual([]);
    expect(report.incomplete).toEqual([]);
    expect(report.passed).toEqual(expect.arrayContaining(["link-name"]));
  });

  it("reports no violations for an owner with the disclosure closed and open", async () => {
    answering({ state: "owner", key: ICE, encoded: ENCODED });
    const user = userEvent.setup();
    const { container } = render(<AccountMenu />);
    const toggle = await screen.findByRole("button", { name: copy.toggle });

    const closed = await checkAccessibility(container);
    expect(closed.violations).toEqual([]);
    expect(closed.incomplete).toEqual([]);
    expect(closed.passed).toEqual(expect.arrayContaining(["button-name"]));

    await user.click(toggle);
    await screen.findByRole("link", { name: copy.yourProfile });
    // Sign-out (#194) is in the open list, so axe checks it too.
    await screen.findByRole("button", { name: copy.signOut });

    const open = await checkAccessibility(container);
    expect(open.violations).toEqual([]);
    expect(open.incomplete).toEqual([]);
    expect(open.passed).toEqual(
      expect.arrayContaining(["button-name", "link-name", "list", "listitem"]),
    );
  });

  it("reports no violations for a signed-in Account with no Handle to link, open", async () => {
    answering({ state: "signed-in" });
    const user = userEvent.setup();
    const { container } = render(<AccountMenu />);
    await user.click(await screen.findByRole("button", { name: copy.toggle }));
    await screen.findByText(copy.noHandle);
    await screen.findByRole("button", { name: copy.signOut });

    const report = await checkAccessibility(container);
    expect(report.violations).toEqual([]);
    expect(report.incomplete).toEqual([]);
    expect(report.passed).toEqual(expect.arrayContaining(["button-name"]));
  });
});
