import { expect, test } from "@playwright/test";
import en from "../../../packages/shared/messages/en.json";
import { seedClaimedHandle } from "./support/seed";

/**
 * The smoke test for a working environment
 * ([#151](https://github.com/joshstothard/3moji/issues/151)).
 *
 * Every other spec can pass against an app that cannot reach its database,
 * because the pages degrade honestly: availability reads "we could not check",
 * and a Profile is never shown. These tests are the ones that cannot. Each
 * asserts something only a migrated database, a complete environment and a
 * working composition root can produce — so if the E2E job loses any of them,
 * this file is where it goes red, and it says why.
 */

const builderCopy = en.HandleBuilder;

test("the home page answers 200", async ({ request }) => {
  const response = await request.get("/", { maxRedirects: 0 });

  expect(response.status()).toBe(200);
});

test("the builder reads real availability from the database", async ({
  page,
}) => {
  // A Handle only the database can know is taken. "Available" would not
  // discriminate as well: it is also what a fresh, empty table says.
  const seeded = await seedClaimedHandle();

  await page.goto("/");
  const search = page.getByRole("searchbox", {
    name: builderCopy.pickerSearchLabel,
  });
  for (const entry of seeded.emoji) {
    await search.fill(entry.displayName);
    await page
      .getByRole("button", { name: entry.displayName, exact: true })
      .click();
  }

  await expect(page.getByText(builderCopy.stateClaimed)).toBeVisible();
  // The load-bearing negative: "unknown" is exactly what a job with no
  // database, or a composition root that throws, produces.
  await expect(page.getByText(builderCopy.stateUnknown)).toHaveCount(0);
});

test("a Handle claimed and given a Profile through the domain shows that Profile", async ({
  page,
  request,
}) => {
  const seeded = await seedClaimedHandle({
    profile: {
      displayName: "Smoke Test Owner",
      bio: "Claimed, verified and edited through packages/core.",
      links: [{ title: "Smoke test link", url: "https://example.com/smoke" }],
    },
  });

  const response = await request.get(seeded.path, { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain(seeded.profile.displayName);
  expect(body).toContain("Smoke test link");

  await page.goto(seeded.path);
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: seeded.profile.displayName,
    }),
  ).toBeVisible();
});
