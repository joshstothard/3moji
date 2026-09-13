import axe from "axe-core";
import type { AxeResults, Result, RuleObject } from "axe-core";

/**
 * The component-level accessibility check
 * ([#152](https://github.com/joshstothard/3moji/issues/152)).
 *
 * `axe-core` is run directly rather than through `jest-axe`. `jest-axe@11`
 * pins its own `axe-core` exactly, and its only types (`@types/jest-axe`)
 * depend on `axe-core@3` — so that route would put three copies of the engine
 * in the lockfile, two of them stale. `axe-core` ships its own types, and the
 * copy here is the one `eslint-plugin-jsx-a11y` already resolves.
 *
 * **What this can check, and what it cannot.** jsdom computes no layout, loads
 * no stylesheet and paints no colour, so every rule that needs those would come
 * back `inapplicable` or `incomplete` and read as a pass that evaluated
 * nothing. Those rules are **disabled by name** below, so a green run never
 * claims them. Colour contrast, focus visibility, target size and every
 * page-level rule (landmarks, the document title, the `lang` attribute, a
 * duplicate id across a whole page) are covered by the rendered-page check in
 * [#153](https://github.com/joshstothard/3moji/issues/153), not here.
 */

/** WCAG 2.0, 2.1 and 2.2, levels A and AA — the level the quality strategy asks for. */
export const WCAG_AA_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
] as const;

/**
 * Rules in {@link WCAG_AA_TAGS} that jsdom cannot evaluate, each with why.
 *
 * Exported so the helper's own test can pin that none of them is ever reported
 * as having passed.
 */
export const RULES_JSDOM_CANNOT_EVALUATE: Readonly<Record<string, string>> = {
  "color-contrast": "jsdom paints no colour and loads no stylesheet",
  "link-in-text-block":
    "compares the computed colour of a link with its surrounding text",
  "target-size": "measures rendered target boxes, and jsdom has no layout",
  "scrollable-region-focusable":
    "needs scroll dimensions, which are always zero in jsdom",
  "css-orientation-lock": "reads the stylesheets' media queries, none loaded",
  "p-as-heading":
    "compares computed font size and weight, which Tailwind classes never set here",
  "document-title": "page-level: a component has no document of its own",
  "html-has-lang": "page-level: the <html> element belongs to the layout",
  "html-lang-valid": "page-level: the <html> element belongs to the layout",
  "html-xml-lang-mismatch":
    "page-level: the <html> element belongs to the layout",
  bypass: "page-level: skip links and landmarks belong to the whole page",
  "meta-viewport": "page-level: <meta> belongs to the document head",
  "meta-refresh": "page-level: <meta> belongs to the document head",
  "aria-hidden-body": "page-level: <body> belongs to the layout",
};

/** A violation reduced to what a failing test needs to print. */
export interface AxeFinding {
  readonly rule: string;
  readonly impact: string | null | undefined;
  readonly help: string;
  readonly nodes: readonly string[];
}

function findingsOf(results: readonly Result[]): readonly AxeFinding[] {
  return results.map((result) => ({
    rule: result.id,
    impact: result.impact,
    help: result.help,
    nodes: result.nodes.map(
      (node) => `${node.target.join(" ")}: ${node.failureSummary ?? node.html}`,
    ),
  }));
}

/** What one axe run reported, in the shape the assertions read. */
export interface AxeReport {
  /** Rules that found a WCAG A/AA failure. Must be empty. */
  readonly violations: readonly AxeFinding[];
  /**
   * Rules axe could not decide. Must be empty too: "needs review" is not a
   * pass, and letting it through is how a check comes to evaluate nothing.
   */
  readonly incomplete: readonly AxeFinding[];
  /** The ids of the rules that ran against something and passed. */
  readonly passed: readonly string[];
}

const disabled: Record<string, RuleObject[string]> = Object.fromEntries(
  Object.keys(RULES_JSDOM_CANNOT_EVALUATE).map((rule) => [
    rule,
    { enabled: false },
  ]),
);

/**
 * Run axe over one rendered component.
 *
 * **Scoped to the container, never to `document`.** jsdom's bare document has
 * no title and no `lang`, so a document-wide run reports the test harness
 * rather than the component.
 */
export async function checkAccessibility(
  container: Element,
): Promise<AxeReport> {
  const results: AxeResults = await axe.run(container, {
    runOnly: { type: "tag", values: [...WCAG_AA_TAGS] },
    rules: disabled,
    resultTypes: ["violations", "incomplete"],
  });

  return {
    violations: findingsOf(results.violations),
    incomplete: findingsOf(results.incomplete),
    passed: results.passes.map((result) => result.id),
  };
}
