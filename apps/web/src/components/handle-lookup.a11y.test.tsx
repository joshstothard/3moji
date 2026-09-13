import { render } from "@testing-library/react";

import { HandleLookup } from "./handle-lookup";
import { checkAccessibility } from "../test-support/axe";

/**
 * The lookup, checked by axe for WCAG 2 A and AA (#200, as #152 does for every
 * component). An unlabelled search box is the usual way a lookup fails, so
 * `label` must be among the rules that actually passed.
 */
describe("the Handle lookup, checked by axe", () => {
  it.each([
    ["empty", undefined],
    ["prefilled", "wibble wobble wubble"],
  ])("reports no violations when %s", async (_state, defaultValue) => {
    const { container } = render(<HandleLookup defaultValue={defaultValue} />);

    const report = await checkAccessibility(container);

    expect(report.violations).toEqual([]);
    expect(report.incomplete).toEqual([]);
    expect(report.passed).toEqual(
      expect.arrayContaining(["label", "button-name"]),
    );
  });
});
