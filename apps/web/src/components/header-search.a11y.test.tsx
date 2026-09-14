import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { checkAccessibility } from "../test-support/axe";
import en from "../../../../packages/shared/messages/en.json";

/**
 * The header search in each state it renders, checked by axe for WCAG 2 A and
 * AA ([#152](https://github.com/joshstothard/3moji/issues/152),
 * [#254](https://github.com/joshstothard/3moji/issues/254)).
 *
 * The open combobox is the state worth checking: the input has to say it
 * controls a listbox and which option is active, and the listbox may own only
 * groups and options. Contrast, focus visibility and target size need a real
 * browser and are checked in `e2e/header-search.spec.ts`.
 *
 * **Fake timers only across the debounce**: axe schedules its own work with
 * timers, so every check runs on real ones.
 */
const copy = en.HeaderSearch;
const ICE = "\u{1F9CA}";
const ICE_CUBES = `${ICE}${ICE}${ICE}`;

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/",
  redirect: jest.fn(),
  notFound: jest.fn(),
}));

import { HeaderSearch, SEARCH_DEBOUNCE_MS } from "./header-search";

beforeEach(() => {
  Object.defineProperty(globalThis, "fetch", {
    value: jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            handles: [
              {
                key: ICE_CUBES,
                encoded: encodeURIComponent(ICE_CUBES),
                alias: "ice-cube.ice-cube.ice-cube",
                displayName: "Ada",
              },
            ],
            emoji: [{ emoji: ICE, name: "ice cube" }],
          }),
      }),
    ),
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("the header search, checked by axe", () => {
  it("reports no violations while closed", async () => {
    const { container } = render(<HeaderSearch />);

    const report = await checkAccessibility(container);

    expect(report.violations).toEqual([]);
    expect(report.incomplete).toEqual([]);
    expect(report.passed).toEqual(
      expect.arrayContaining(["button-name", "label", "aria-allowed-attr"]),
    );
  });

  it("reports no violations with results open and an option active, and with the phone panel open", async () => {
    jest.useFakeTimers();
    const typing = userEvent.setup({
      advanceTimers: jest.advanceTimersByTime,
    });
    const { container } = render(<HeaderSearch />);
    const box = screen.getByRole("combobox", { name: copy.label });

    await typing.click(box);
    await typing.type(box, "ice-cube");
    await act(async () => {
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      await Promise.resolve();
    });
    jest.useRealTimers();
    const user = userEvent.setup();
    await screen.findAllByRole("option");
    await user.keyboard("{ArrowDown}");

    const open = await checkAccessibility(container);
    expect(open.violations).toEqual([]);
    expect(open.incomplete).toEqual([]);
    expect(open.passed).toEqual(
      expect.arrayContaining([
        "aria-allowed-attr",
        "aria-required-children",
        "aria-required-parent",
        "aria-valid-attr-value",
        "label",
      ]),
    );

    await user.click(screen.getByRole("button", { name: copy.open }));
    const panel = await checkAccessibility(container);
    expect(panel.violations).toEqual([]);
    expect(panel.incomplete).toEqual([]);
    expect(panel.passed).toEqual(expect.arrayContaining(["button-name"]));
  });
});
