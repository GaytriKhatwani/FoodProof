import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { createInvitation, deleteInvitations, enterPilot, type CreatedInvitation } from "./helpers";
import { E2E_ORIGIN } from "./origin";

/**
 * Community preview, consent, review request and withdrawal — screens §6, plus
 * the fixed `?from_concern=` cross-link contract with T3. The reporter journey
 * runs in the browser; the owner's approval is performed through the reviewer's
 * own API session in a second context, because the reviewer UI belongs to T3.
 */

test.describe.configure({ mode: "serial" });

const accessIds: string[] = [];
let invitation: CreatedInvitation | null = null;
let reviewerInvitation: CreatedInvitation | null = null;
let reportId: string | null = null;

async function signIn(page: Page): Promise<void> {
  if (!invitation) {
    invitation = await createInvitation("user");
    accessIds.push(invitation.accessId);
  }
  await enterPilot(page, invitation.code);
}

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

const uuid = () => crypto.randomUUID();

async function ok(request: APIRequestContext, method: "post" | "patch" | "get", path: string, options = {}) {
  const response = await request[method](path, options);
  if (!response.ok()) {
    throw new Error(`${method.toUpperCase()} ${path} failed (${response.status()}): ${await response.text()}`);
  }
  return (await response.json()).data;
}

/**
 * Build a report the server itself calls `ready`, through the real API. The
 * editor UI path is covered by reporter-editor.spec.ts; this keeps the sharing
 * spec focused on §6.
 */
async function seedReadyReport(page: Page): Promise<string> {
  const request = page.request;
  const headers = (key: string) => ({ Origin: E2E_ORIGIN, "Idempotency-Key": key });

  const created = await ok(request, "post", "/api/reports", {
    headers: headers(uuid()),
    data: { product_name: "Sample Pantry Rice Snaps", brand: "Sample Pantry", expected_version: null },
  });
  const id = created.report_id as string;

  await ok(request, "post", `/api/reports/${id}/evidence`, {
    headers: headers(uuid()),
    multipart: {
      file: { name: "label.png", mimeType: "image/png", buffer: samplePng() },
      kind: "label",
      roles: JSON.stringify(["identity", "claim", "ingredients"]),
    },
  });

  const afterUpload = await ok(request, "get", `/api/reports/${id}`);
  const patched = await ok(request, "patch", `/api/reports/${id}`, {
    headers: headers(uuid()),
    data: {
      product_name: "Sample Pantry Rice Snaps",
      brand: "Sample Pantry",
      concern_text: "The sample pack claims gluten-free while the ingredients list wheat starch.",
      claim_text: "Gluten free",
      ingredients_text: "Wheat starch, sugar, salt",
      expected_version: afterUpload.version,
    },
  });
  await ok(request, "post", `/api/reports/${id}/confirm-facts`, {
    headers: headers(uuid()),
    data: {
      expected_version: patched.version,
      claim_text: "Gluten free",
      ingredients_text: "Wheat starch, sugar, salt",
      method: "manual",
    },
  });
  return id;
}

/** Approve the pending concern revision as the owner (reviewer invitation). */
async function approveAsOwner(page: Page, targetReportId: string): Promise<void> {
  if (!reviewerInvitation) {
    reviewerInvitation = await createInvitation("reviewer");
    accessIds.push(reviewerInvitation.accessId);
  }
  const context = await page.context().browser()!.newContext({ baseURL: E2E_ORIGIN });
  try {
    const reviewerPage = await context.newPage();
    await enterPilot(reviewerPage, reviewerInvitation.code);
    // KNOWN SERVER DEFECT (reported to the integration owner, fix in progress):
    // Supabase reads made inside a route handler are served from Next's fetch
    // Data Cache, which also persists in `.next/cache/fetch-cache`. The FIRST
    // GET /api/review/queue in a fresh cache is correct; every later one replays
    // that frozen payload, so the request this spec just created is missing and
    // this lookup throws. Deliberately NOT worked around here — no cache
    // busting, no hand-rolled fetch — so the defect stays visible until the
    // non-caching Supabase fetch lands on main.
    const queue = await ok(reviewerPage.request, "get", "/api/review/queue");
    const item = (queue.items as { publication_revision_id: string; report_id: string }[]).find(
      (entry) => entry.report_id === targetReportId,
    );
    if (!item) throw new Error("no pending review request for the report");
    const detail = await ok(reviewerPage.request, "get", `/api/review/${item.publication_revision_id}`);
    await ok(reviewerPage.request, "post", `/api/review/${item.publication_revision_id}/decision`, {
      headers: { Origin: E2E_ORIGIN, "Idempotency-Key": uuid() },
      data: { expected_version: detail.version, action: "approve" },
    });
  } finally {
    await context.close();
  }
}

test.afterAll(async () => {
  await deleteInvitations(accessIds);
  accessIds.length = 0;
  invitation = null;
  reviewerInvitation = null;
  reportId = null;
});

test("an incomplete report cannot be proposed, and says so without blocking private work", async ({
  page,
}) => {
  await signIn(page);
  const draft = await ok(page.request, "post", "/api/reports", {
    headers: { Origin: E2E_ORIGIN, "Idempotency-Key": uuid() },
    data: { product_name: "Sample Pantry Thin Crackers", brand: "Sample Pantry", expected_version: null },
  });

  await page.goto(`/pilot/reports/${draft.report_id}/share`);
  await expect(page.getByText("This report is not ready to be proposed for review yet.")).toBeVisible();
  await expect(page.getByText("Your private record is unaffected", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request publication review" })).toBeDisabled();
});

test("consent is required before a review request can be sent", async ({ page }) => {
  await signIn(page);
  reportId = await seedReadyReport(page);

  await page.goto(`/pilot/reports/${reportId}/share`);
  await expect(page.getByRole("heading", { name: "Preview community version" })).toBeVisible();
  await expect(page.getByText("Sample Pantry Rice Snaps")).toBeVisible();

  const consent = page.getByRole("checkbox", { name: /I want this version and the photos/ });
  await expect(consent).not.toBeChecked();
  await page.getByRole("button", { name: "Request publication review" }).click();
  await expect(page.getByText("Tick the consent box before sending this for review.")).toBeVisible();
});

test("with consent the request is sent for owner review, never called published", async ({ page }) => {
  test.skip(!reportId, "depends on the seeded report");
  await signIn(page);
  await page.goto(`/pilot/reports/${reportId}/share`);

  await page.getByRole("checkbox", { name: /I want this version and the photos/ }).check();
  await page.getByRole("button", { name: "Request publication review" }).click();

  await expect(page.getByText("Sent for owner review. Nothing is published yet")).toBeVisible();
  await expect(page.getByText("Community status:")).toContainText("Sent for owner review");
  await expect(page.getByRole("button", { name: "Request publication review" })).toBeDisabled();
});

test("after the owner approves, the record links to the community version", async ({ page }) => {
  test.skip(!reportId, "depends on the seeded report");
  await signIn(page);
  await approveAsOwner(page, reportId as string);

  await page.goto(`/pilot/reports/${reportId}`);
  await expect(
    page.getByRole("definition").filter({ hasText: "Published in the pilot community" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "See the community version" })).toHaveAttribute(
    "href",
    `/pilot/concerns/${reportId}`,
  );
});

test("the from-concern link copies product identity only", async ({ page }) => {
  test.skip(!reportId, "depends on the published report");
  await signIn(page);
  await page.goto(`/pilot/reports/new?from_concern=${reportId}`);

  await expect(page.getByText(/copied from a community concern/)).toBeVisible();
  await expect(page.getByLabel("Product name")).toHaveValue("Sample Pantry Rice Snaps");
  await expect(page.getByLabel("Brand", { exact: true })).toHaveValue("Sample Pantry");
  // R09: no evidence, no text, no history is carried across.
  await page.getByRole("button", { name: "3 Concern" }).click();
  await expect(page.getByLabel("Your concern")).toHaveValue("");
  await expect(page.getByLabel("Gluten-free wording on the label")).toHaveValue("");
});

test("withdrawing hides the community version and keeps the private record", async ({ page }) => {
  test.skip(!reportId, "depends on the published report");
  await signIn(page);
  await page.goto(`/pilot/reports/${reportId}/share`);

  await page.getByRole("button", { name: "Withdraw community sharing" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/private report, its evidence and its history are preserved/)).toBeVisible();
  await dialog.getByRole("button", { name: "Yes, withdraw it" }).click();

  await expect(page.getByText("Community status:")).toContainText("Withdrawn from the community");
  await page.goto(`/pilot/reports/${reportId}`);
  await expect(page.getByText("Sample Pantry Rice Snaps").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "See the community version" })).toHaveCount(0);
});
