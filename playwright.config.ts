import { defineConfig, devices } from "@playwright/test";
import { E2E_ORIGIN, E2E_PORT } from "./tests/e2e/origin";

/**
 * Browser-test harness (Playwright). Runs against a real `next dev` server so
 * the pilot middleware gate and same-origin API checks execute for real — no
 * mocked fetch. See tests/e2e/global-setup.ts for env loading.
 */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: E2E_ORIGIN,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 740 } },
    },
  ],
  webServer: {
    command: `npm run dev -- -p ${E2E_PORT}`,
    url: E2E_ORIGIN,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
