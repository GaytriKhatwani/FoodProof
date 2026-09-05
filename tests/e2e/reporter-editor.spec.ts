import { test, expect, type Page } from "@playwright/test";
import { createInvitation, deleteInvitations, enterPilot, type CreatedInvitation } from "./helpers";

/**
 * Guided editor specs — docs/FOODPROOF_SCREENS.md §5.
 * These run against the live T1 API (no fixtures): a real invitation, a real
 * save, a real multipart upload and the server's own readiness rule. Everything
 * created here is deleted in `afterAll`. The `mobile` project replays the same
 * specs at 360 px, so nothing may depend on a wide viewport.
 */

test.describe.configure({ mode: "serial" });

const accessIds: string[] = [];
let invitation: CreatedInvitation | null = null;
let reportId: string | null = null;

/** One user invitation for the whole file; re-entered for each test's context. */
async function signIn(page: Page): Promise<void> {
  if (!invitation) {
    invitation = await createInvitation("user");
    accessIds.push(invitation.accessId);
  }
  await enterPilot(page, invitation.code);
}

/** Smallest valid 1×1 PNG — same construction as tests/helpers/live.ts. */
function samplePng(): Buffer {
  const chunk = (type: string, data: number[]) => {
    const length = data.length;
    const bytes = [(length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff];
    for (const character of type) bytes.push(character.charCodeAt(0));
    bytes.push(...data, 0, 0, 0, 0);
    return bytes;
  };
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
    ...chunk("IDAT", [0x78, 0x9c, 0x62, 0, 0, 0, 2, 0, 1]),
    ...chunk("IEND", []),
  ]);
}

test.afterAll(async () => {
  await deleteInvitations(accessIds);
  accessIds.length = 0;
  invitation = null;
  reportId = null;
});

test("saves an incomplete private draft that survives a reload", async ({ page }) => {
  await signIn(page);
  await page.goto("/pilot/reports/new");

  await expect(page.getByRole("heading", { name: "Raise a concern" })).toBeVisible();
  await page.getByLabel("Product name").fill("Sample Pantry Crisp Bites");
  await page.getByLabel("Brand", { exact: true }).fill("Sample Pantry");
  await page.getByRole("button", { name: "Save private draft" }).click();

  await expect(page.getByText("Saved to the demo service.")).toBeVisible();
  await expect(page).toHaveURL(/\/pilot\/reports\/[0-9a-f-]{36}\/edit$/);
  reportId = new URL(page.url()).pathname.split("/")[3] ?? null;
  expect(reportId).toBeTruthy();

  await page.reload();
  await expect(page.getByLabel("Product name")).toHaveValue("Sample Pantry Crisp Bites");
  await expect(page.getByLabel("Brand", { exact: true })).toHaveValue("Sample Pantry");
  // Preparation is the server's answer, and an evidence-less draft is not ready.
  await expect(page.getByText("Preparation Draft")).toBeVisible();
});

test("a blocked save keeps every typed value on screen", async ({ page }) => {
  await signIn(page);
  await page.goto("/pilot/reports/new");

  await page.getByLabel("Product name").fill("Sample Pantry Wafers");
  await page.getByLabel("Your concern");
  await page.getByRole("button", { name: "Save private draft" }).click();

  await expect(page.getByText("Enter the brand.")).toBeVisible();
  await expect(page.getByLabel("Product name")).toHaveValue("Sample Pantry Wafers");
});

test("uploads a label photo, assigns roles, and the server readiness follows", async ({ page }) => {
  test.skip(!reportId, "depends on the draft created above");
  await signIn(page);
  await page.goto(`/pilot/reports/${reportId}/edit`);

  await page.getByRole("button", { name: "2 Evidence" }).click();
  await page.getByLabel("Choose a file").setInputFiles({
    name: "sample-label.png",
    mimeType: "image/png",
    buffer: samplePng(),
  });
  const uploadRoles = page.getByRole("group", { name: /What does this photo show/ });
  await uploadRoles.getByRole("checkbox", { name: "Product identity" }).check();
  await uploadRoles.getByRole("checkbox", { name: "Gluten-free claim" }).check();
  await uploadRoles.getByRole("checkbox", { name: "Ingredient list" }).check();
  await page.getByRole("button", { name: "Upload file" }).click();

  await expect(page.getByRole("heading", { name: "Label photos (1)" })).toBeVisible();
  const savedRoles = page.getByRole("group", { name: "Roles for this photo" });
  await expect(savedRoles.getByRole("checkbox", { name: "Product identity" })).toBeChecked();

  // Readiness still needs a concern and confirmed facts, so it stays Draft.
  await page.getByRole("button", { name: "4 Review" }).click();
  await expect(page.getByText("The demo service reports this record as")).toBeVisible();
  await expect(page.getByText("Missing Concern explanation")).toBeVisible();
});

test("confirming facts and a concern makes the server report the record ready", async ({ page }) => {
  test.skip(!reportId, "depends on the draft created above");
  await signIn(page);
  await page.goto(`/pilot/reports/${reportId}/edit`);

  await page.getByRole("button", { name: "3 Concern" }).click();
  await page
    .getByLabel("Your concern")
    .fill("The front of the sample pack says gluten-free but the ingredients list wheat starch.");
  await page.getByLabel("Gluten-free wording on the label").fill("Gluten free");
  await page.getByLabel("Ingredient wording").fill("Wheat starch, sugar, salt");
  await page.getByRole("button", { name: "Save private draft" }).click();
  await expect(page.getByText("Saved to the demo service.")).toBeVisible();

  await page.getByRole("button", { name: "I checked this wording against my photo" }).click();
  await expect(page.getByText(/^You confirmed this wording on/)).toBeVisible();

  await page.getByRole("button", { name: "4 Review" }).click();
  await expect(page.getByText("Ready to request review").first()).toBeVisible();
  await expect(page.getByText("Missing", { exact: false })).toHaveCount(0);
});

test("a from-concern link that cannot be loaded prefills nothing and says so", async ({ page }) => {
  await signIn(page);
  await page.goto("/pilot/reports/new?from_concern=00000000-0000-4000-8000-000000000000");

  await expect(page.getByText(/could not be loaded, so nothing was prefilled/)).toBeVisible();
  await expect(page.getByLabel("Product name")).toHaveValue("");
});

test("a stale save shows the reload prompt and keeps the reporter's text", async ({ page, context }) => {
  test.skip(!reportId, "depends on the draft created above");
  await signIn(page);
  await page.goto(`/pilot/reports/${reportId}/edit`);

  // A second tab in the same demo session saves first, so this tab's
  // expected_version is behind.
  const other = await context.newPage();
  await other.goto(`/pilot/reports/${reportId}/edit`);
  await other.getByLabel("Batch number (optional)").fill("BATCH-OTHER-TAB");
  await other.getByRole("button", { name: "Save private draft" }).click();
  await expect(other.getByText("Saved to the demo service.")).toBeVisible();
  await other.close();

  await page.getByLabel("Batch number (optional)").fill("BATCH-THIS-TAB");
  await page.getByRole("button", { name: "Save private draft" }).click();

  await expect(page.getByText("This record changed since you loaded it.")).toBeVisible();
  await expect(page.getByLabel("Batch number (optional)")).toHaveValue("BATCH-THIS-TAB");

  // Reloading keeps the unsaved text; saving is blocked until the reload lands,
  // so the retry can never carry the old expected_version.
  await page.getByRole("button", { name: "Reload the saved version" }).click();
  await expect(page.getByText(/Reloaded the saved version/)).toBeVisible();
  await expect(page.getByLabel("Batch number (optional)")).toHaveValue("BATCH-THIS-TAB");
  await page.getByRole("button", { name: "Save private draft" }).click();
  await expect(page.getByText("Saved to the demo service.")).toBeVisible();
  await expect(page.getByText("This record changed since you loaded it.")).toHaveCount(0);
});
