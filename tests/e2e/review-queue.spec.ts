import { test, expect } from "@playwright/test";
import { createInvitation, deleteInvitations, enterPilot } from "./helpers";

/**
 * Reviewer queue — `/pilot/review` (docs/FOODPROOF_SCREENS.md §10).
 * Role separation only; the decision surface is covered in
 * review-decisions.spec.ts and the moderation loop in
 * review-moderation.spec.ts.
 */

const createdAccessIds: string[] = [];

test.afterAll(async () => {
  await deleteInvitations(createdAccessIds);
});

test.describe("reviewer role separation", () => {
  test("a reviewer invitation lands on the review queue and gets the Review nav item", async ({
    page,
  }) => {
    const invitation = await createInvitation("reviewer", "reviewer@foodproof");
    createdAccessIds.push(invitation.accessId);

    await page.goto("/pilot");
    await page.getByLabel("Invitation code").fill(invitation.code);
    await page.getByRole("button", { name: "Enter demo" }).click();
    await page.getByRole("button", { name: "Continue without analytics" }).click();

    await expect(page).toHaveURL(/\/pilot\/review$/);
    await expect(page.getByRole("heading", { level: 1, name: "Review queue" })).toBeVisible();
    await expect(page.getByRole("banner")).toContainText("reviewer@foodproof");

    const nav = page.getByRole("navigation", { name: "Pilot" });
    await expect(nav.getByRole("link", { name: "Review" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Feed" })).toBeVisible();

    // Approving is described as publication, never as a safety verdict.
    await expect(page.getByText(/not a safety verdict/)).toBeVisible();
  });

  test("a user invitation is refused the review queue and never sees the link", async ({
    page,
  }) => {
    const invitation = await createInvitation("user");
    createdAccessIds.push(invitation.accessId);
    await enterPilot(page, invitation.code);

    await page.goto("/pilot/feed");
    const nav = page.getByRole("navigation", { name: "Pilot" });
    await expect(nav.getByRole("link", { name: "Review" })).toHaveCount(0);

    // The route is not hidden behind the missing link: the API refuses it.
    await page.goto("/pilot/review");
    await expect(
      page.getByRole("heading", { name: "This area needs a reviewer invitation" }),
    ).toBeVisible();
    await expect(page.getByText(/Roles are set by the invitation/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to the community feed" })).toBeVisible();
  });
});
