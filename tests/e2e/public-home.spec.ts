import { test, expect } from "@playwright/test";

/**
 * Public-home + middleware smoke specs. These must pass against the current
 * scaffold (no T3 pilot UI yet) — they exercise only what T0/this slice ships:
 * the static homepage and the `/pilot/:path+` middleware gate.
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
});

test.describe("pilot middleware gate", () => {
  test("visiting a pilot subpath without a session cookie redirects to /pilot", async ({ page }) => {
    await page.context().clearCookies();
    const response = await page.goto("/pilot/feed");
    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/pilot(\?.*)?$/);
  });
});
