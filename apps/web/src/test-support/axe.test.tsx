import { render } from "@testing-library/react";
import { checkAccessibility, RULES_JSDOM_CANNOT_EVALUATE } from "./axe";

/**
 * The helper itself ([#152](https://github.com/joshstothard/3moji/issues/152)).
 *
 * Two properties make a green run mean something: a rule jsdom cannot evaluate
 * is never counted as evaluated, and a real failure is reported rather than
 * swallowed.
 */
describe("the component accessibility check", () => {
  it("never reports a rule jsdom cannot evaluate, even where it would apply", async () => {
    // Text, a link inside a paragraph and a styled button: the elements the
    // colour, link-in-text-block and target-size rules select.
    const { container } = render(
      <p style={{ color: "#777", background: "#888" }}>
        Read <a href="https://example.com/about">more</a>{" "}
        <button type="button">Go</button>
      </p>,
    );

    const report = await checkAccessibility(container);
    const reported = [
      ...report.passed,
      ...report.violations.map((finding) => finding.rule),
      ...report.incomplete.map((finding) => finding.rule),
    ];

    for (const rule of Object.keys(RULES_JSDOM_CANNOT_EVALUATE)) {
      expect(reported).not.toContain(rule);
    }
    expect(report.passed).toEqual(
      expect.arrayContaining(["button-name", "link-name"]),
    );
  });

  it("reports a control with no accessible name as a violation", async () => {
    const { container } = render(
      <button type="button">
        <span aria-hidden="true">x</span>
      </button>,
    );

    const report = await checkAccessibility(container);

    expect(report.violations.map((finding) => finding.rule)).toEqual([
      "button-name",
    ]);
  });
});
