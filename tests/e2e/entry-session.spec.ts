import { test, expect, type Page } from "@playwright/test";
import { SESSION_COOKIE } from "@/lib/session-cookie";
import { createInvitation, deleteInvitations } from "./helpers";

/**
 * Invitation entry, analytics consent and the middleware gate
 * (docs/FOODPROOF_SCREENS.md §2). These specs drive the real `/pilot` form
 * rather than the `enterPilot` API helper, because the form IS what is being
 * tested. Every invitation created here is deleted in `afterAll`.
 */

const createdAccessIds: string[] = [];

test.afterAll(async () => {
  await deleteInvitations(createdAccessIds);
});

async function submitCode(page: Page, code: string) {
  await page.getByLabel("Invitation code").fill(code);
  await page.getByRole("button", { name: "Enter demo" }).click();
}

test.describe("pilot entry", () => {
  test("a valid user invitation reaches the feed after an analytics choice", async ({ page }) => {
    const invitation = await createInvitation("user", "user@foodproof");
    createdAccessIds.push(invitation.accessId);

    await page.goto("/pilot");
    await expect(page.getByRole("heading", { level: 1, name: "FoodProof pilot" })).toBeVisible();
    // Phase one has no login: none of these may appear.
    await expect(page.getByLabel("Password")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /google/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /one-time|otp/i })).toHaveCount(0);

    await submitCode(page, invitation.code);

    await expect(page.getByRole("heading", { name: "Usage analytics" })).toBeVisible();
    await page.getByRole("button", { name: "Continue without analytics" }).click();

    await expect(page).toHaveURL(/\/pilot\/feed$/);
    await expect(page.getByRole("heading", { level: 1, name: "Community concerns" })).toBeVisible();
  });

  test("each analytics choice is recorded through the consent route", async ({ page }) => {
    for (const choice of ["Allow usage analytics", "Continue without analytics"] as const) {
      const invitation = await createInvitation("user");
      createdAccessIds.push(invitation.accessId);

      await page.context().clearCookies();
      await page.goto("/pilot");
      await submitCode(page, invitation.code);

      // Declining is a first-class choice: it is written through the same
      // route as allowing, not skipped as a dismissal.
      const consentCall = page.waitForResponse(
        (response) =>
          response.url().includes("/api/me/analytics-consent") &&
          response.request().method() === "PUT",
      );
      await page.getByRole("button", { name: choice }).click();
      const response = await consentCall;
      expect(response.status()).toBe(200);
      expect((await response.json()).data.analytics_consent).toBe(
        choice === "Allow usage analytics",
      );

      await expect(page).toHaveURL(/\/pilot\/feed$/);
    }
  });

  test("an unaccepted code shows one generic failure and never says why", async ({ page }) => {
    await page.goto("/pilot");
    await submitCode(page, "not-a-real-invitation-code");

    // Scoped to the form: Next's route announcer is also `role="alert"`.
    const error = page.locator("form").getByRole("alert");
    await expect(error).toContainText("That invitation code was not accepted");
    // The message must not distinguish unknown from expired or revoked.
    await expect(error).not.toContainText(/expired|revoked|unknown|not found/i);
    await expect(page).toHaveURL(/\/pilot(\?.*)?$/);
    await expect(page.getByRole("heading", { name: "Usage analytics" })).toHaveCount(0);
  });

  /*
   * A14: a session whose consent is withdrawn emits no optional event. The
   * server refuses one anyway (`{"accepted": false}`), but a refused request
   * is still a request: the browser must not attempt to report anything after
   * a withdrawal. Asserted on the wire, not on a mock.
   */
  test("no analytics request is made after consent is withdrawn", async ({ page }) => {
    const invitation = await createInvitation("user", "user@foodproof");
    createdAccessIds.push(invitation.accessId);

    await page.context().clearCookies();
    await page.goto("/pilot");
    await submitCode(page, invitation.code);
    await page.getByRole("button", { name: "Allow usage analytics" }).click();
    await expect(page).toHaveURL(/\/pilot\/feed$/);

    const header = page.getByRole("banner");
    await expect(header).toContainText("Usage analytics: allowed");

    // Consented: the feed really does report itself, so the assertion below
    // is about the withdrawal and not about a route that never emits.
    const allowed: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/analytics")) allowed.push(request.url());
    });
    await page.getByRole("link", { name: "My reports" }).click();
    await page.getByRole("link", { name: "Feed" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Community concerns" })).toBeVisible();
    await expect.poll(() => allowed.length).toBeGreaterThan(0);

    await header.getByRole("button", { name: "Withdraw consent" }).click();
    await expect(header).toContainText("Usage analytics: off");

    const afterWithdrawal: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/analytics")) afterWithdrawal.push(request.url());
    });

    await page.getByRole("link", { name: "My reports" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "My reports" })).toBeVisible();
    await page.getByRole("link", { name: "Feed" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Community concerns" })).toBeVisible();
    await page.getByLabel("Search product or brand").fill("sample");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByText(/Showing \d+ reviewed concern|No reports match|No concerns loaded/)).toBeVisible();

    expect(afterWithdrawal).toEqual([]);
  });

  // A reviewer invitation landing on `/pilot/review` is covered in
  // review-queue.spec.ts, next to the rest of the reviewer surface.

  test("a requested pilot destination survives the middleware redirect", async ({ page }) => {
    const invitation = await createInvitation("user");
    createdAccessIds.push(invitation.accessId);

    await page.context().clearCookies();
    await page.goto("/pilot/concerns/00000000-0000-4000-8000-000000000000");
    await expect(page).toHaveURL(/\/pilot\?next=%2Fpilot%2Fconcerns%2F/);

    await submitCode(page, invitation.code);
    await page.getByRole("button", { name: "Continue without analytics" }).click();

    await expect(page).toHaveURL(/\/pilot\/concerns\/00000000-0000-4000-8000-000000000000$/);
  });
});

test.describe("pilot shell", () => {
  test("shows the test identity, hides Review from a user, and exits to the home page", async ({
    page,
  }) => {
    const invitation = await createInvitation("user", "user@foodproof");
    createdAccessIds.push(invitation.accessId);

    await page.goto("/pilot");
    await submitCode(page, invitation.code);
    await page.getByRole("button", { name: "Continue without analytics" }).click();
    await expect(page).toHaveURL(/\/pilot\/feed$/);

    const header = page.getByRole("banner");
    await expect(header).toContainText("Demo · sample or redacted data");
    await expect(header).toContainText("user@foodproof");
    await expect(header).toContainText("Test identity");

    const nav = page.getByRole("navigation", { name: "Pilot" });
    await expect(nav.getByRole("link", { name: "Feed" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "My reports" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Review" })).toHaveCount(0);

    // The analytics preference can be changed from the shell at any time.
    await expect(header).toContainText("Usage analytics: off");
    await header.getByRole("button", { name: "Allow analytics" }).click();
    await expect(header).toContainText("Usage analytics: allowed");

    await header.getByRole("button", { name: "Exit demo" }).click();
    await expect(page).toHaveURL(/\/$/);

    // The session is really gone: a pilot subpath bounces back to entry.
    await page.goto("/pilot/feed");
    await expect(page).toHaveURL(/\/pilot\?next=%2Fpilot%2Ffeed$/);
  });

  test("a session that ends mid-visit shows the ended state and never renders content", async ({
    page,
  }) => {
    const invitation = await createInvitation("user");
    createdAccessIds.push(invitation.accessId);

    await page.goto("/pilot");
    await submitCode(page, invitation.code);
    await page.getByRole("button", { name: "Continue without analytics" }).click();
    await expect(page).toHaveURL(/\/pilot\/feed$/);

    // Keep the middleware's cookie presence check satisfied while the session
    // itself is invalid, so the shell (not the middleware) handles it.
    await page.context().addCookies([
      {
        name: SESSION_COOKIE,
        value: "invalid-session-token",
        domain: new URL(page.url()).hostname,
        path: "/",
      },
    ]);
    await page.reload();

    await expect(
      page.getByRole("heading", { level: 1, name: "Your pilot session has ended" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Community concerns" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Enter with your invitation" })).toHaveAttribute(
      "href",
      "/pilot?next=%2Fpilot%2Ffeed",
    );
  });
});
