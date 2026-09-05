import { test, expect } from "@playwright/test";

/**
 * Public home (docs/FOODPROOF_SCREENS.md §1) and the `/pilot/:path+` middleware
 * gate. The homepage is the one screen an uninvited visitor sees, so these
 * specs check both what it says and what it must never do: request pilot data,
 * preview a report, or claim any relationship to a government body.
 */

test.describe("public home", () => {
  test("anonymous visitor sees the pilot CTA and makes no pilot-data request", async ({ page }) => {
    const pilotDataRequests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (/\/api\/feed(\/|\?|$)/.test(url) || /\/api\/reports(\/|\?|$)/.test(url)) {
        pilotDataRequests.push(url);
      }
    });

    await page.goto("/");

    await expect(page.getByRole("link", { name: "Enter invited pilot" })).toBeVisible();
    expect(pilotDataRequests).toEqual([]);
  });

  test("separates FoodProof from official filing and labels the pilot as illustrative", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Food labels deserve a closer look.",
    );
    await expect(
      page.getByText("Publishing here does not file a government complaint"),
    ).toBeVisible();
    await expect(page.getByText("Submit complaints through the responsible")).toBeVisible();
    await expect(page.getByText(/illustrative example using sample or redacted/)).toBeVisible();

    const footer = page.getByRole("contentinfo");
    await expect(footer).toContainText("independent project with no government affiliation");
    await expect(footer).toContainText("does not file complaints");
    // The contact route is the owner's to configure; the page never invents one.
    await expect(footer).toContainText("the same channel your invitation arrived on");
    await expect(footer.getByRole("link")).toHaveCount(0);
  });

  test("is keyboard reachable and offers no login", async ({ page }) => {
    await page.goto("/");

    // The skip link is the first focusable element and targets the landmark.
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await expect(skip).toHaveAttribute("href", "#main");
    await expect(page.locator("main#main")).toHaveCount(1);

    // Phase one has invitation entry only.
    await expect(page.getByRole("link", { name: /log ?in|sign ?in/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /google|otp/i })).toHaveCount(0);
  });
});

test.describe("pilot middleware gate", () => {
  test("visiting a pilot subpath without a session cookie redirects to /pilot", async ({ page }) => {
    await page.context().clearCookies();
    const response = await page.goto("/pilot/feed");
    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/pilot(\?.*)?$/);
  });
});
