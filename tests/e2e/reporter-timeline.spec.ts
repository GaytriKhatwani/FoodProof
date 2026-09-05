import { test, expect, type Page } from "@playwright/test";
import { createInvitation, deleteInvitations, enterPilot, type CreatedInvitation } from "./helpers";

/**
 * Private timeline specs — docs/FOODPROOF_SCREENS.md §8 and §9.
 * Covers the reporter-recorded external history (kept separate per channel), a
 * private response, a manual follow-up, and closure/reopen wording. Runs against
 * the live T1 API and deletes everything it creates.
 */

test.describe.configure({ mode: "serial" });

const accessIds: string[] = [];
let invitation: CreatedInvitation | null = null;
let reportId: string | null = null;

async function signIn(page: Page): Promise<void> {
  if (!invitation) {
    invitation = await createInvitation("user");
    accessIds.push(invitation.accessId);
  }
  await enterPilot(page, invitation.code);
}

test.afterAll(async () => {
  await deleteInvitations(accessIds);
  accessIds.length = 0;
  invitation = null;
  reportId = null;
});

test("opens a saved report and shows the three status dimensions separately", async ({ page }) => {
  await signIn(page);
  await page.goto("/pilot/reports/new");
  await page.getByLabel("Product name").fill("Sample Pantry Oat Mix");
  await page.getByLabel("Brand", { exact: true }).fill("Sample Pantry");
  await page.getByRole("button", { name: "Save private draft" }).click();
  await expect(page.getByText("Saved to the demo service.")).toBeVisible();
  reportId = new URL(page.url()).pathname.split("/")[3] ?? null;

  await page.goto(`/pilot/reports/${reportId}`);
  await expect(page.getByRole("heading", { name: "Sample Pantry Oat Mix" })).toBeVisible();
  await expect(page.getByRole("term").filter({ hasText: "Preparation" })).toBeVisible();
  await expect(page.getByRole("term").filter({ hasText: "Community visibility" })).toBeVisible();
  await expect(page.getByRole("term").filter({ hasText: "Personal follow-up" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Brand actions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Official actions" })).toBeVisible();
});

test("records a brand submission, a private response and a follow-up", async ({ page }) => {
  test.skip(!reportId, "depends on the report created above");
  await signIn(page);
  await page.goto(`/pilot/reports/${reportId}`);

  const brandSection = page.getByRole("region", { name: "Brand actions" });
  await brandSection.getByRole("button", { name: "Record a submission" }).click();
  const submissionDialog = page.getByRole("dialog");
  await submissionDialog.getByLabel("Who you sent it to").fill("Sample Pantry consumer care");
  await submissionDialog.getByLabel("Reference or ticket number (optional)").fill("SP-DEMO-1");
  await submissionDialog.getByRole("button", { name: "Save submission record" }).click();

  await expect(page.getByText("Submission recorded by reporter", { exact: false })).toBeVisible();
  await expect(page.getByText("No response recorded.")).toBeVisible();
  // The official history stays empty and separate.
  const officialSection = page.getByRole("region", { name: "Official actions" });
  await expect(officialSection.getByText("No submission recorded.", { exact: false })).toBeVisible();

  await brandSection.getByRole("button", { name: "Add a response" }).click();
  const responseDialog = page.getByRole("dialog");
  await responseDialog.getByLabel("Who replied").fill("Sample Pantry customer team");
  await responseDialog
    .getByLabel("What did they say?")
    .fill("They said the packaging is being reviewed. Fictional demo content.");
  await responseDialog.getByRole("button", { name: "Save private response" }).click();
  await expect(page.getByRole("heading", { name: "Response saved privately" })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await expect(page.getByText("Response recorded by reporter")).toBeVisible();

  await brandSection.getByRole("button", { name: "Record follow-up" }).click();
  const followUpDialog = page.getByRole("dialog");
  await followUpDialog.getByLabel("What did you do?").fill("Sent a reminder email. Fictional demo content.");
  await followUpDialog.getByRole("button", { name: "Save follow-up" }).click();
  await expect(page.getByText("Follow-up recorded by reporter")).toBeVisible();
});

test("closes with a reason that never claims safety, then reopens", async ({ page }) => {
  test.skip(!reportId, "depends on the report created above");
  await signIn(page);
  await page.goto(`/pilot/reports/${reportId}`);

  await page.getByRole("button", { name: "Close my follow-up" }).click();
  const closeDialog = page.getByRole("dialog");
  await expect(
    closeDialog.getByText(/does not establish that the product is safe/),
  ).toBeVisible();
  await closeDialog.getByLabel("Why are you stopping?").fill("Waiting on the brand. Fictional demo content.");
  await closeDialog.getByRole("button", { name: "Close my follow-up" }).click();

  await expect(page.getByRole("definition").filter({ hasText: "Closed by reporter" })).toBeVisible();
  await expect(page.getByText(/Waiting on the brand/).first()).toBeVisible();

  await page.getByRole("button", { name: "Reopen my follow-up" }).click();
  await expect(page.getByRole("button", { name: "Close my follow-up" })).toBeVisible();
  await expect(page.getByText("Follow-up reopened by reporter")).toBeVisible();
});

test("an unknown report id shows the not-available state without other data", async ({ page }) => {
  await signIn(page);
  await page.goto("/pilot/reports/00000000-0000-4000-8000-000000000000");
  await expect(page.getByText("This record is not available.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to my reports" })).toBeVisible();
});
