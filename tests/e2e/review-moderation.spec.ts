import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createInvitation, deleteInvitations, enterPilot } from "./helpers";
import { E2E_ORIGIN } from "./origin";
import { samplePng } from "../helpers/sample-image";

/**
 * The complete moderation loop across two people: a reporter requests
 * publication, the reviewer approves it in the review screen, the concern
 * appears in the community feed, a reader files a private correction request,
 * the reviewer handles it, and the reporter's withdrawal removes it again
 * (docs/FOODPROOF_WORKFLOWS.md §6, docs/FOODPROOF_SCREENS.md §3, §4, §10).
 *
 * The reporter side runs through the API because the reporter UI (T2) is on
 * another branch; every reviewer and reader action is driven through the real
 * screens. Everything created here is deleted in `afterAll`.
 */

const createdAccessIds: string[] = [];

test.afterAll(async () => {
  await deleteInvitations(createdAccessIds);
});

async function apiCall(
  request: APIRequestContext,
  method: "get" | "post",
  path: string,
  data?: unknown,
) {
  const response = await request[method](path, {
    headers: { Origin: E2E_ORIGIN, "Idempotency-Key": randomUUID() },
    ...(data === undefined ? {} : { data }),
  });
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBe(true);
  return body.data;
}

/** Reporter: new report → label evidence with all three roles → confirmed facts → consented request. */
async function requestPublication(request: APIRequestContext, productName: string) {
  const report = await apiCall(request, "post", "/api/reports", {
    product_name: productName,
    brand: "Loop Brand (fictional)",
    variant: "Classic",
    concern_text: "SAMPLE: the pack claims gluten-free while the ingredients list wheat.",
    expected_version: null,
  });

  const upload = await request.post(`/api/reports/${report.report_id}/evidence`, {
    headers: { Origin: E2E_ORIGIN, "Idempotency-Key": randomUUID() },
    multipart: {
      file: { name: "label.png", mimeType: "image/png", buffer: Buffer.from(samplePng()) },
      kind: "label",
      roles: JSON.stringify(["identity", "claim", "ingredients"]),
    },
  });
  const uploaded = await upload.json();
  expect(upload.ok(), JSON.stringify(uploaded)).toBe(true);

  let current = await apiCall(request, "get", `/api/reports/${report.report_id}`);
  await apiCall(request, "post", `/api/reports/${report.report_id}/confirm-facts`, {
    expected_version: current.version,
    claim_text: "Gluten-free (front of pack)",
    ingredients_text: "Wheat flour, millet flour, sugar, salt",
    method: "manual",
  });

  current = await apiCall(request, "get", `/api/reports/${report.report_id}`);
  const revision = await apiCall(
    request,
    "post",
    `/api/reports/${report.report_id}/publication-requests`,
    {
      expected_version: current.version,
      consent: true,
      selected_evidence_ids: [uploaded.data.id],
    },
  );

  return {
    reportId: report.report_id as string,
    revisionId: revision.publication_revision_id as string,
  };
}

async function approveInReviewUi(page: Page, revisionId: string) {
  await page.goto(`/pilot/review/${revisionId}`);
  // The request is fetched client-side; wait for the decision form to exist
  // before counting its checklist items.
  await expect(page.getByRole("button", { name: "Approve publication" })).toBeVisible();
  const checkboxes = page.getByRole("checkbox");
  const count = await checkboxes.count();
  for (let index = 0; index < count; index += 1) {
    await checkboxes.nth(index).check();
  }
  await page.getByRole("button", { name: "Approve publication" }).click();
  await expect(page.getByRole("heading", { name: "Approved for publication" })).toBeVisible();
}

test.describe("moderation loop", () => {
  test("approved concern reaches the feed, can be flagged and handled, and withdrawal removes it", async ({
    browser,
    page,
  }) => {
    const reporterInvitation = await createInvitation("user", "user@foodproof");
    createdAccessIds.push(reporterInvitation.accessId);
    const reviewerInvitation = await createInvitation("reviewer", "reviewer@foodproof");
    createdAccessIds.push(reviewerInvitation.accessId);

    const reporterContext = await browser.newContext();
    const reporterPage = await reporterContext.newPage();

    try {
      await enterPilot(reporterPage, reporterInvitation.code);
      await enterPilot(page, reviewerInvitation.code);

      const productName = `Loop Wafers ${Date.now()}`;
      const { reportId, revisionId } = await requestPublication(reporterPage.request, productName);

      // 1. The reviewer approves the frozen snapshot in the review screen.
      await approveInReviewUi(page, revisionId);

      // 2. It becomes visible in the community feed for a reader.
      await reporterPage.goto("/pilot/feed");
      await expect(
        reporterPage.getByText(/Showing \d+ reviewed concern|No concerns loaded/),
      ).toBeVisible();
      await reporterPage.getByLabel("Search product or brand").fill(productName);
      await reporterPage.getByRole("button", { name: "Search" }).click();
      const card = reporterPage.getByRole("listitem").filter({ hasText: productName });
      await expect(card).toBeVisible();
      await card.getByRole("link", { name: "View concern" }).click();
      await expect(
        reporterPage.getByRole("heading", { level: 1, name: `${productName} · Classic` }),
      ).toBeVisible();

      // 3. A reader files a private correction request from the concern.
      await reporterPage
        .getByRole("button", { name: "Flag a concern or request a correction" })
        .click();
      await reporterPage
        .getByLabel("Reason (required)")
        .fill("SAMPLE: the batch code is readable in the photo.");
      await reporterPage.getByRole("button", { name: "Send request to the reviewer" }).click();
      await expect(
        reporterPage.getByRole("heading", { name: "Request recorded for review" }),
      ).toBeVisible();
      await expect(reporterPage.getByText(/No response time is promised/)).toBeVisible();

      // 4. The reviewer sees it in the queue and handles it with a reason.
      await page.goto("/pilot/review");
      const flagRow = page
        .getByRole("listitem")
        .filter({ hasText: "SAMPLE: the batch code is readable in the photo." });
      await expect(flagRow).toBeVisible();
      await flagRow.getByRole("button", { name: "Handle this request" }).click();
      await flagRow
        .getByLabel("Review reason (required)")
        .fill("SAMPLE: checked, the code is not legible; keeping it visible.");
      await flagRow.getByRole("button", { name: "Keep visible and record this reason" }).click();
      await expect(flagRow).toHaveCount(0);

      // 5. The reporter withdraws; the concern stops being served.
      await apiCall(reporterPage.request, "post", `/api/reports/${reportId}/withdraw`);
      await reporterPage.goto(`/pilot/concerns/${reportId}`);
      await expect(
        reporterPage.getByRole("heading", { level: 1, name: "This concern is not available" }),
      ).toBeVisible();
    } finally {
      await reporterContext.close();
    }
  });
});
