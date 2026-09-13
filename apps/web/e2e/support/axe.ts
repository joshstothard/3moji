import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import type { Result } from "axe-core";

/**
 * The rendered-page accessibility check
 * ([#153](https://github.com/joshstothard/3moji/issues/153)).
 *
 * The component check in `src/test-support/axe.ts`
 * ([#152](https://github.com/joshstothard/3moji/issues/152)) runs in jsdom,
 * which has no layout, no stylesheet and no document of its own, so it disables
 * by name every rule that needs them. This is where those rules run: axe is
 * injected into a real Chromium page with the app's real CSS, over the whole
 * document, **with no rule disabled and nothing excluded**. Colour contrast,
 * target size, the document title, `lang` and `bypass` are evaluated here and
 * nowhere else.
 *
 * **What the WCAG tags do not include.** `landmark-one-main` and `region` are
 * tagged `best-practice` by axe, not WCAG, so they never load under the tags
 * below. `bypass` is the WCAG 2.4.1 rule for landmarks and skip links, and it
 * is the one asserted. Adding `best-practice` would pull in a large set of
 * rules the quality strategy does not ask for.
 */

/**
 * WCAG 2.0, 2.1 and 2.2, levels A and AA — the same tags as the component
 * check. Repeated rather than imported, because that module imports the
 * `axe-core` engine at the top level for jsdom and this one must not.
 */
export const WCAG_AA_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
] as const;

/**
 * Rules that apply to every page the layout renders, and so must have run and
 * passed on each of them. A check where one of these is absent evaluated less
 * than it claims.
 */
export const PAGE_RULES = [
  "color-contrast",
  "bypass",
  "document-title",
  "html-has-lang",
  "html-lang-valid",
  "meta-viewport",
  "link-name",
  "target-size",
] as const;

/** A finding reduced to what a failing assertion needs to print. */
export interface PageFinding {
  readonly rule: string;
  readonly impact: string | null | undefined;
  readonly help: string;
  readonly nodes: readonly string[];
}

/** What one axe run over a rendered page reported. */
export interface PageReport {
  /** WCAG A/AA failures. Must be empty. */
  readonly violations: readonly PageFinding[];
  /**
   * Rules axe could not decide. Must be empty too, as in the component check:
   * "needs review" is not a pass.
   */
  readonly incomplete: readonly PageFinding[];
  /** The ids of the rules that applied to something and passed. */
  readonly passed: readonly string[];
}

function findingsOf(results: readonly Result[]): readonly PageFinding[] {
  return results.map((result) => ({
    rule: result.id,
    impact: result.impact,
    help: result.help,
    nodes: result.nodes.map(
      (node) => `${node.target.join(" ")}: ${node.failureSummary ?? node.html}`,
    ),
  }));
}

/** Run axe over the whole rendered page, as it is now. */
export async function checkPage(page: Page): Promise<PageReport> {
  const results = await new AxeBuilder({ page })
    .withTags([...WCAG_AA_TAGS])
    .analyze();

  return {
    violations: findingsOf(results.violations),
    incomplete: findingsOf(results.incomplete),
    passed: results.passes.map((result) => result.id),
  };
}
