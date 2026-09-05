import { test, expect, type Page } from "@playwright/test";
import { createInvitation, deleteInvitations, enterPilot } from "./helpers";

/**
 * Community feed — `/pilot/feed` (docs/FOODPROOF_SCREENS.md §3).
 *
 * Read-only assertions against the fictional example published by
 * `scripts/seed.mjs`. The demo Supabase project is shared, so nothing here
 * asserts on the exact size of the feed — only that the seeded example is
 * present, findable, and absent from a search that should not match it.
 */

const SEED_PRODUCT = "Millet Cookies (sample)";
const SEED_BRAND = "Testbrand Foods (fictional)";

/**
 * Wait until the feed has loaded its first page. The count line only appears
 * after the client fetch resolves, which also means React has hydrated and the
 * search form's submit handler is attached.
 */
async function expectFeedInteractive(page: Page) {
  await expect(
    page.getByText(/Showing \d+ reviewed concern|No concerns loaded|No reviewed concerns yet/),
  ).toBeVisible();
}

const createdAccessIds: string[] = [];

test.afterAll(async () => {
  await deleteInvitations(createdAccessIds);
});

test.describe("community feed", () => {
  test("shows the seeded fictional concern with its anonymous attribution", async ({ page }) => {
    const invitation = await createInvitation("user");
    createdAccessIds.push(invitation.accessId);
    await enterPilot(page, invitation.code);

    await page.goto("/pilot/feed");
    await expect(page.getByRole("heading", { level: 1, name: "Community concerns" })).toBeVisible();
    await expect(page.getByText(/do not establish|does not establish/i).first()).toBeVisible();
    await expectFeedInteractive(page);

    // The demo project is shared with other agents' runs, so the seeded example
    // is not guaranteed to sit on the first page. Search for it rather than
    // asserting a position: the server filters before it paginates.
    await page.getByLabel("Search product or brand").fill(SEED_PRODUCT);
    await page.getByRole("button", { name: "Search" }).click();

    const item = page.getByRole("listitem").filter({ hasText: SEED_PRODUCT });
    await expect(item).toBeVisible();
    await expect(item).toContainText(SEED_BRAND);
    await expect(item).toContainText("Anonymous contributor");
    await expect(item).toContainText("Illustrative example");
    await expect(item.getByRole("link", { name: "View concern" })).toBeVisible();
  });

  test("search finds the seeded brand and reports a result count", async ({ page }) => {
    const invitation = await createInvitation("user");
    createdAccessIds.push(invitation.accessId);
    await enterPilot(page, invitation.code);

    await page.goto("/pilot/feed");
    await expectFeedInteractive(page);
    await page.getByLabel("Search product or brand").fill("Testbrand");
    await page.getByRole("button", { name: "Search" }).click();

    await expect(page.getByRole("listitem").filter({ hasText: SEED_PRODUCT })).toBeVisible();
    await expect(page.getByText(/Showing \d+ reviewed concern/)).toBeVisible();
  });

  test("an empty search says a missing report is not a safety guarantee", async ({ page }) => {
    const invitation = await createInvitation("user");
    createdAccessIds.push(invitation.accessId);
    await enterPilot(page, invitation.code);

    await page.goto("/pilot/feed");
    await expectFeedInteractive(page);
    await page.getByLabel("Search product or brand").fill(`zzq-no-such-product-${Date.now()}`);
    await page.getByRole("button", { name: "Search" }).click();

    await expect(page.getByRole("heading", { name: "No reports match this search" })).toBeVisible();
    await expect(page.getByText("That is not a safety guarantee")).toBeVisible();

    await page.getByRole("button", { name: "Clear search" }).first().click();
    await expect(page.getByRole("heading", { name: "No reports match this search" })).toHaveCount(0);
    await expect(page.getByText(/Showing \d+ reviewed concern/)).toBeVisible();
  });
});
