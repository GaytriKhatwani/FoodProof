import { test, expect, type Page } from "@playwright/test";
import { createInvitation, deleteInvitations, enterPilot } from "./helpers";

/**
 * Layout guard for the public and community screens. The `mobile` project runs
 * every spec at 360 px, so these assertions are the real test there: no screen
 * may scroll the page sideways, and the pilot navigation must stay reachable
 * when the header wraps (docs/FOODPROOF_SCREENS.md, visual defaults).
 */

const SEED_PRODUCT = "Millet Cookies (sample)";

const createdAccessIds: string[] = [];

test.afterAll(async () => {
  await deleteInvitations(createdAccessIds);
});

async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  // One pixel of tolerance for sub-pixel rounding.
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
}

test.describe("layout", () => {
  test("public home and pilot entry never scroll sideways", async ({ page }) => {
    await page.goto("/");
    await expectNoSidewaysScroll(page);

    await page.goto("/pilot");
    await expect(page.getByLabel("Invitation code")).toBeVisible();
    await expectNoSidewaysScroll(page);
  });

  test("feed and concern detail never scroll sideways and keep the nav reachable", async ({
    page,
  }) => {
    const invitation = await createInvitation("user", "user@foodproof");
    createdAccessIds.push(invitation.accessId);
    await enterPilot(page, invitation.code);

    await page.goto("/pilot/feed");
    await expect(page.getByRole("heading", { level: 1, name: "Community concerns" })).toBeVisible();
    await expectNoSidewaysScroll(page);

    const nav = page.getByRole("navigation", { name: "Pilot" });
    await expect(nav.getByRole("link", { name: "Feed" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "My reports" })).toBeVisible();

    // Found by search: the shared demo project may push the seeded example off
    // the first page of the feed. The count line proves the feed has loaded and
    // hydrated before the form is used.
    await expect(page.getByText(/Showing \d+ reviewed concern|No concerns loaded/)).toBeVisible();
    await page.getByLabel("Search product or brand").fill(SEED_PRODUCT);
    await page.getByRole("button", { name: "Search" }).click();
    const link = page
      .getByRole("listitem")
      .filter({ hasText: SEED_PRODUCT })
      .getByRole("link", { name: "View concern" });
    await expect(link).toHaveAttribute("href", /source=search$/);
    await link.click();
    await expect(page.getByRole("heading", { level: 1, name: SEED_PRODUCT })).toBeVisible();
    await expectNoSidewaysScroll(page);

    // The evidence viewer must not widen the page either.
    await page.getByRole("button", { name: /Approved evidence 1 of/ }).click();
    await expect(page.getByRole("dialog", { name: "Evidence image" })).toBeVisible();
    await expectNoSidewaysScroll(page);
    await page.keyboard.press("Escape");
  });
});
