import { test, expect, type Page } from "@playwright/test";
import { createInvitation, deleteInvitations, enterPilot } from "./helpers";

/**
 * Community concern detail — `/pilot/concerns/:reportId`
 * (docs/FOODPROOF_SCREENS.md §4). Read-only assertions against the fictional
 * example published by `scripts/seed.mjs`; filing a flag is exercised in
 * review-moderation.spec.ts, on a concern that spec owns and cleans up.
 */

const SEED_PRODUCT = "Millet Cookies (sample)";

/**
 * Open the seeded example from the feed. The demo project is shared with other
 * agents' runs, so the example is found by searching rather than by assuming it
 * sits on the first page.
 */
async function openSeededConcern(page: Page) {
  await expectFeedInteractive(page);
  await page.getByLabel("Search product or brand").fill(SEED_PRODUCT);
  await page.getByRole("button", { name: "Search" }).click();

  const link = page
    .getByRole("listitem")
    .filter({ hasText: SEED_PRODUCT })
    .getByRole("link", { name: "View concern" });
  // Waiting for the searched link proves the results rerendered, so the click
  // cannot land on the pre-search card.
  await expect(link).toHaveAttribute("href", /source=search$/);
  await link.click();
}

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

test.describe("community concern detail", () => {
  test("shows the approved projection, its evidence and its reviewed response", async ({
    page,
  }) => {
    const invitation = await createInvitation("user");
    createdAccessIds.push(invitation.accessId);
    await enterPilot(page, invitation.code);

    await page.goto("/pilot/feed");
    await openSeededConcern(page);

    await expect(page).toHaveURL(/\/pilot\/concerns\/[0-9a-f-]{36}\?source=search$/);
    await expect(page.getByRole("heading", { level: 1, name: SEED_PRODUCT })).toBeVisible();

    // Approved for publication is never presented as verified safety.
    await expect(page.getByText("Approved for publication is not verified safety")).toBeVisible();
    await expect(page.getByText(/does not file anything with any authority/)).toBeVisible();

    // Approved evidence is served through the guarded publication-asset route.
    const image = page.getByRole("img", { name: /Approved evidence image 1 of/ });
    await expect(image).toBeVisible();
    const source = await image.getAttribute("src");
    expect(source).toMatch(/^\/api\/publication-assets\/[0-9a-f-]{36}$/);

    // The guarded route must serve the bytes to this session, not just resolve
    // to a URL. That those bytes decode in the browser is asserted separately,
    // in tests/e2e/media-decodes.spec.ts.
    const asset = await page.request.get(source as string);
    expect(asset.status()).toBe(200);
    expect(asset.headers()["content-type"]).toMatch(/^image\//);

    // Confirmed label facts, quoted from the reporter's own confirmation.
    await expect(page.getByText("Gluten-free (front of pack)")).toBeVisible();
    await expect(page.getByText("Wheat flour, millet flour, sugar, salt")).toBeVisible();

    // External status is the reporter's own record FROZEN at publication time.
    // The seed records its submission after requesting publication, so the
    // approved snapshot legitimately still reads "no submission recorded" even
    // though a later response was published — that is the contract, not a bug.
    const actions = page.getByRole("region", { name: "Recorded actions and reviewed updates" });
    await expect(actions.getByRole("listitem").first()).toHaveText(
      "Brand: No external submission recorded",
    );
    await expect(actions.getByRole("listitem").nth(1)).toHaveText(
      "Official channel: No external submission recorded",
    );
    await expect(page.getByText(/It is not a government status/)).toBeVisible();
    await expect(page.getByText(/does not mean anyone ignored the reporter/)).toBeVisible();

    // The separately reviewed response summary, attributed to the reporter.
    await expect(page.getByText(/the brand acknowledges the labelling issue/i)).toBeVisible();
    await expect(page.getByText("Recorded by reporter")).toBeVisible();

    // Independent reporting carries the product identity only.
    const contribute = page.getByRole("link", { name: "Report this product independently" });
    await expect(contribute).toHaveAttribute(
      "href",
      /^\/pilot\/reports\/new\?from_concern=[0-9a-f-]{36}$/,
    );
  });

  test("the evidence viewer opens, zooms and closes with the keyboard", async ({ page }) => {
    const invitation = await createInvitation("user");
    createdAccessIds.push(invitation.accessId);
    await enterPilot(page, invitation.code);

    await page.goto("/pilot/feed");
    await openSeededConcern(page);

    await page.getByRole("button", { name: /Approved evidence 1 of/ }).click();
    const dialog = page.getByRole("dialog", { name: "Evidence image" });
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "Zoom in" }).click();
    await expect(dialog.getByRole("button", { name: "Fit to screen" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("an unknown concern id shows the unavailable state and no private content", async ({
    page,
  }) => {
    const invitation = await createInvitation("user");
    createdAccessIds.push(invitation.accessId);
    await enterPilot(page, invitation.code);

    await page.goto("/pilot/concerns/00000000-0000-4000-8000-000000000000");

    await expect(
      page.getByRole("heading", { level: 1, name: "This concern is not available" }),
    ).toBeVisible();
    await expect(page.getByText(/withdrawn|removed in review/)).toBeVisible();
  });
});
