import { expect, test } from "@playwright/test";

import en from "../../../packages/shared/messages/en.json";

/**
 * The privacy notice and the terms of use, rendered by the real app
 * ([#196](https://github.com/joshstothard/3moji/issues/196)).
 *
 * The unit tests prove what each page says; this proves both routes exist,
 * answer 200 rather than falling through to `/[handle]`, and show the draft
 * marker and every section in a real browser, in both Playwright projects.
 * Their axe and contrast checks are in `accessibility.spec.ts`.
 */
const legal = en.Legal;

for (const [path, copy, relatedPath] of [
  ["/privacy", legal.Privacy, "/terms"],
  ["/terms", legal.Terms, "/privacy"],
] as const) {
  test(`${path} shows the draft marker and every section`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);

    await expect(
      page.getByRole("heading", { level: 1, name: copy.heading }),
    ).toBeVisible();
    await expect(page.getByText(legal.draftMarker)).toBeVisible();
    await expect(page).toHaveTitle(copy.metaTitle);

    for (const section of Object.values(copy.sections)) {
      await expect(
        page.getByRole("region", { name: section.heading }),
      ).toBeVisible();
    }

    await expect(
      page.getByRole("link", { name: copy.relatedLink }),
    ).toHaveAttribute("href", relatedPath);
  });
}
