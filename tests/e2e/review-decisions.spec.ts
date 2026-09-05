import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createInvitation, deleteInvitations, enterPilot } from "./helpers";
import { E2E_ORIGIN } from "./origin";

/**
 * Reviewer decisions and stale recovery — `/pilot/review/:requestId`
 * (docs/FOODPROOF_SCREENS.md §10).
 *
 * The reporter side runs through the API because the reporter UI (T2) lives on
 * another branch; the reviewer side is driven through the real screen. Every
 * invitation created here, and everything created under it, is deleted in
 * `afterAll`.
 */

const createdAccessIds: string[] = [];

test.afterAll(async () => {
  await deleteInvitations(createdAccessIds);
});

/** A 1x1 PNG, the same shape the operator seed uploads as sample evidence. */
function samplePng(): Buffer {
  const chunk = (type: string, data: number[]) => {
    const length = data.length;
    const bytes = [(length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff];
    for (const char of type) bytes.push(char.charCodeAt(0));
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

async function apiSession(request: APIRequestContext, code: string) {
  const response = await request.post("/api/demo/session", {
    headers: { Origin: E2E_ORIGIN },
    data: { invitation_code: code },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

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

/**
 * Drive a reporter, through the API, from a new report to a pending
 * publication request: evidence covering all three label roles, confirmed
 * facts, then a consented publication request.
 */
async function requestPublication(request: APIRequestContext, productName: string) {
  const report = await apiCall(request, "post", "/api/reports", {
    product_name: productName,
    brand: "Probe Brand (fictional)",
    variant: null,
    concern_text: "SAMPLE: the pack claims gluten-free while the ingredients list wheat.",
    expected_version: null,
  });

  const upload = await request.post(`/api/reports/${report.report_id}/evidence`, {
    headers: { Origin: E2E_ORIGIN, "Idempotency-Key": randomUUID() },
    multipart: {
      file: { name: "label.png", mimeType: "image/png", buffer: samplePng() },
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

  return { reportId: report.report_id as string, revisionId: revision.publication_revision_id as string };
}

async function enterAsReviewer(page: Page) {
  const invitation = await createInvitation("reviewer", "reviewer@foodproof");
  createdAccessIds.push(invitation.accessId);
  await enterPilot(page, invitation.code);
}

async function enterAsReporter(request: APIRequestContext) {
  const invitation = await createInvitation("user", "user@foodproof");
  createdAccessIds.push(invitation.accessId);
  await apiSession(request, invitation.code);
}

/** Tick every evidence and privacy checkbox on the decision form. */
async function confirmChecklists(page: Page) {
  // The request is fetched client-side; wait for the decision form to exist
  // before counting its checklist items.
  await expect(page.getByRole("button", { name: "Approve publication" })).toBeVisible();
  const checkboxes = page.getByRole("checkbox");
  const count = await checkboxes.count();
  for (let index = 0; index < count; index += 1) {
    await checkboxes.nth(index).check();
  }
}

test.describe("reviewer decisions", () => {
  test("shows the frozen snapshot and its evidence, and approves only after the checklists", async ({
    page,
    request,
  }) => {
    await enterAsReporter(request);
    const productName = `Probe Wafers ${Date.now()}`;
    const { revisionId } = await requestPublication(request, productName);
    await enterAsReviewer(page);

    await page.goto("/pilot/review");
    const queueItem = page.getByRole("listitem").filter({ hasText: productName });
    await expect(queueItem).toBeVisible();
    await expect(queueItem).toContainText("Probe Brand (fictional)");
    await queueItem.getByRole("link", { name: "Review this request" }).click();

    await expect(page).toHaveURL(new RegExp(`/pilot/review/${revisionId}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Review this request" })).toBeVisible();

    // The exact frozen snapshot, plus its raw form for verification.
    const snapshot = page.getByRole("region", { name: "Proposed community version" });
    await expect(snapshot).toContainText(productName);
    await expect(snapshot).toContainText("Gluten-free (front of pack)");
    await snapshot.getByRole("button", { name: "Show the exact stored snapshot" }).click();
    await expect(snapshot.locator("pre")).toContainText('"concern_summary"');

    // The frozen evidence copy, served through the guarded media route.
    const evidence = page.getByRole("region", { name: "Evidence in this request" });
    await expect(evidence.getByRole("img", { name: /Frozen evidence image 1 of 1/ })).toHaveAttribute(
      "src",
      /^\/api\/publication-assets\/[0-9a-f-]{36}$/,
    );

    // Approve is unavailable until both checklists are confirmed.
    const approve = page.getByRole("button", { name: "Approve publication" });
    await expect(approve).toBeDisabled();
    await confirmChecklists(page);
    await expect(approve).toBeEnabled();

    await approve.click();
    await expect(page.getByRole("heading", { name: "Approved for publication" })).toBeVisible();
    await expect(page.getByText(/not a statement that the product is safe/)).toBeVisible();
  });

  test("requesting changes requires a reason and records it", async ({ page, request }) => {
    await enterAsReporter(request);
    const productName = `Probe Crackers ${Date.now()}`;
    const { revisionId } = await requestPublication(request, productName);
    await enterAsReviewer(page);

    await page.goto(`/pilot/review/${revisionId}`);
    await page.getByRole("button", { name: "Request changes" }).click();
    await expect(page.getByText("A reason is required before requesting changes or rejecting.")).toBeVisible();

    await page
      .getByLabel("Reason or requested correction")
      .fill("SAMPLE: crop the photo so the batch code is not visible.");
    await page.getByRole("button", { name: "Request changes" }).click();

    await expect(page.getByRole("heading", { name: "Changes requested" })).toBeVisible();
    await expect(page.getByText(/keeps their private record and can revise/)).toBeVisible();
  });

  test("a request decided elsewhere shows the stale state instead of deciding twice", async ({
    page,
    request,
  }) => {
    await enterAsReporter(request);
    const productName = `Probe Biscuits ${Date.now()}`;
    const { revisionId } = await requestPublication(request, productName);
    await enterAsReviewer(page);

    // Load the request first, so the reviewer holds the version that is about
    // to become stale.
    await page.goto(`/pilot/review/${revisionId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Review this request" })).toBeVisible();

    // The same request is decided elsewhere, through the API.
    const decided = await page.request.post(`/api/review/${revisionId}/decision`, {
      headers: { Origin: E2E_ORIGIN, "Idempotency-Key": randomUUID() },
      data: { expected_version: 0, action: "reject", reason: "SAMPLE: decided in another session." },
    });
    expect(decided.ok(), await decided.text()).toBe(true);

    await confirmChecklists(page);
    await page.getByRole("button", { name: "Approve publication" }).click();

    await expect(
      page.getByRole("heading", { name: "This request changed. Reload before reviewing" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Reload this request" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Approved for publication" })).toHaveCount(0);
  });

  test("an already decided request offers no second decision", async ({ page, request }) => {
    await enterAsReporter(request);
    const productName = `Probe Rusks ${Date.now()}`;
    const { revisionId } = await requestPublication(request, productName);
    await enterAsReviewer(page);

    const decided = await page.request.post(`/api/review/${revisionId}/decision`, {
      headers: { Origin: E2E_ORIGIN, "Idempotency-Key": randomUUID() },
      data: { expected_version: 0, action: "reject", reason: "SAMPLE: already handled." },
    });
    expect(decided.ok(), await decided.text()).toBe(true);

    await page.goto(`/pilot/review/${revisionId}`);
    await expect(
      page.getByRole("heading", { name: "This request was already rejected" }),
    ).toBeVisible();
    await expect(page.getByText("SAMPLE: already handled.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve publication" })).toHaveCount(0);
  });
});
