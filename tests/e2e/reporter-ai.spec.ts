import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import {
  createInvitation,
  deleteInvitations,
  enterPilot,
  liveClient,
  type CreatedInvitation,
} from "./helpers";
import { E2E_ORIGIN } from "./origin";

/**
 * Reporter-facing AI assistance — docs/FOODPROOF_SCREENS.md §5/§7,
 * docs/FOODPROOF_TECHNICAL_SPEC.md §8.
 *
 * Two tests make REAL, metered provider calls (one extraction, one draft) on a
 * single shared report, because live assistance is part of phase-one
 * acceptance and a fixture must never be presented as live AI. Everything else
 * — unavailable, rate-limited, not-configured — is routed in the browser so it
 * costs nothing and stays deterministic. The mocked tests prove the manual and
 * template paths still work; they prove nothing about the provider.
 *
 * Both Playwright projects (desktop and 360 px mobile) replay the whole file,
 * so a run costs two real calls per project.
 */

test.describe.configure({ mode: "serial" });

/** The one honest failure line every assisted failure shows. */
const UNAVAILABLE = "AI assistance unavailable—continue manually.";

/** The fictional label photograph shipped with the app. */
const LABEL_PHOTO = path.resolve(__dirname, "../../public/illustrative-label.jpg");

const accessIds: string[] = [];
let invitation: CreatedInvitation | null = null;
/** Carries the two real provider calls. */
let assistedReportId: string | null = null;
/** Only ever sees routed failures, so its recorded methods stay honest. */
let manualReportId: string | null = null;

async function signIn(page: Page): Promise<void> {
  if (!invitation) {
    invitation = await createInvitation("user");
    accessIds.push(invitation.accessId);
  }
  await enterPilot(page, invitation.code);
}

const uuid = () => crypto.randomUUID();

async function ok(
  request: APIRequestContext,
  method: "post" | "get",
  route: string,
  options = {},
) {
  const response = await request[method](route, options);
  if (!response.ok()) {
    throw new Error(
      `${method.toUpperCase()} ${route} failed (${response.status()}): ${await response.text()}`,
    );
  }
  return (await response.json()).data;
}

const headers = () => ({ Origin: E2E_ORIGIN, "Idempotency-Key": uuid() });

/** Create a private draft through the real API; evidence is added separately. */
async function createReport(page: Page, productName: string): Promise<string> {
  const created = await ok(page.request, "post", "/api/reports", {
    headers: headers(),
    data: { product_name: productName, brand: "Sample Pantry", expected_version: null },
  });
  return created.report_id as string;
}

/** Attach the fictional label photograph with all three roles. */
async function attachLabelPhoto(page: Page, reportId: string): Promise<void> {
  await ok(page.request, "post", `/api/reports/${reportId}/evidence`, {
    headers: headers(),
    multipart: {
      file: {
        name: "illustrative-label.jpg",
        mimeType: "image/jpeg",
        buffer: readFileSync(LABEL_PHOTO),
      },
      kind: "label",
      roles: JSON.stringify(["identity", "claim", "ingredients"]),
    },
  });
}

/** The method recorded for the newest `facts_confirmed` event of a report. */
async function newestConfirmationMethod(reportId: string): Promise<unknown> {
  const { data, error } = await liveClient()
    .from("report_events")
    .select("type, metadata, occurred_at")
    .eq("report_id", reportId)
    .eq("type", "facts_confirmed")
    .order("occurred_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`report_events read failed: ${error.message}`);
  return (data?.[0]?.metadata as { method?: unknown } | undefined)?.method;
}

async function savedDraftMethod(reportId: string, channel: string): Promise<unknown> {
  const { data, error } = await liveClient()
    .from("complaint_drafts")
    .select("channel, method")
    .eq("report_id", reportId)
    .eq("channel", channel)
    .maybeSingle();
  if (error) throw new Error(`complaint_drafts read failed: ${error.message}`);
  return data?.method;
}

/** Fulfil an API route with the app's own error envelope, without a real call. */
async function routeEnvelope(
  page: Page,
  glob: string,
  status: number,
  code: string,
  message: string,
  extraHeaders: Record<string, string> = {},
): Promise<void> {
  await page.route(glob, (route) =>
    route.fulfill({
      status,
      headers: { "content-type": "application/json", ...extraHeaders },
      body: JSON.stringify({ error: { code, message }, request_id: "e2e" }),
    }),
  );
}

test.afterAll(async () => {
  await deleteInvitations(accessIds);
  accessIds.length = 0;
  invitation = null;
  assistedReportId = null;
  manualReportId = null;
});

test("live extraction suggests wording the reporter applies, then confirms as assisted", async ({
  page,
}) => {
  // A real provider call plus a real upload; the default 30s is not enough.
  test.setTimeout(180_000);
  await signIn(page);
  assistedReportId = await createReport(page, "Sample Pantry Crisp Bites");

  // Upload the fictional photograph through the real form, as a reporter would.
  await page.goto(`/pilot/reports/${assistedReportId}/edit`);
  await page.getByRole("button", { name: "2 Evidence" }).click();
  await page.getByLabel("Choose a file").setInputFiles(LABEL_PHOTO);
  const uploadRoles = page.getByRole("group", { name: /What does this photo show/ });
  await uploadRoles.getByRole("checkbox", { name: "Product identity" }).check();
  await uploadRoles.getByRole("checkbox", { name: "Gluten-free claim" }).check();
  await uploadRoles.getByRole("checkbox", { name: "Ingredient list" }).check();
  await page.getByRole("button", { name: "Upload file" }).click();
  await expect(page.getByRole("heading", { name: "Label photos (1)" })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "3 Concern" }).click();
  await page
    .getByLabel("Your concern")
    .fill("The sample pack front says gluten-free; I want the wording checked.");

  // #3: viewing the screen must not, on its own, send anything to the provider.
  let extractCalls = 0;
  page.on("request", (r) => {
    if (r.url().includes("/ai/extract")) extractCalls += 1;
  });
  expect(extractCalls).toBe(0);

  await page.getByRole("button", { name: "Suggest wording from my photos" }).click();

  // The disclosure appears BEFORE any request, names the 30-day retention, and
  // no request has fired yet.
  await expect(page.getByRole("heading", { name: "Before you use AI assistance" })).toBeVisible();
  await expect(page.getByText(/up to 30 days/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Suggested text — check against your photo" }),
  ).toHaveCount(0);
  expect(extractCalls).toBe(0);

  // Only a deliberate acknowledgement runs the assisted call.
  await page.getByRole("button", { name: "Send to AI assistance" }).click();
  await expect(
    page.getByRole("heading", { name: "Suggested text — check against your photo" }),
  ).toBeVisible({ timeout: 120_000 });
  expect(extractCalls).toBeGreaterThan(0);

  // Applying a suggestion is a deliberate per-field click, never automatic.
  const claimRow = page
    .locator("li")
    .filter({ hasText: "Gluten-free wording" })
    .filter({ has: page.getByRole("button", { name: "Use this" }) });
  await claimRow.getByRole("button", { name: "Use this" }).click();
  const claimField = page.getByLabel("Gluten-free wording on the label");
  await expect(claimField).toHaveValue(/gluten/i);

  await page.getByRole("button", { name: "I checked this wording against my photo" }).click();
  await expect(page.getByText(/^You confirmed this wording on/)).toBeVisible();

  // The server recorded the provenance the UI claimed.
  expect(await newestConfirmationMethod(assistedReportId)).toBe("assisted");

  // A metered live call should be observable in the run log rather than hidden
  // behind a green tick. Only the shipped fictional photograph is ever read.
  // eslint-disable-next-line no-console
  console.log(`[e2e] live extraction applied claim: ${await claimField.inputValue()}`);
});

test("live assisted draft is labelled, editable, and saved as assisted", async ({ page }) => {
  test.skip(!assistedReportId, "depends on the confirmed report above");
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto(`/pilot/reports/${assistedReportId}/actions`);

  // The deterministic template is the baseline before any assistance.
  const body = page.getByLabel("Message", { exact: true });
  await expect(body).toContainText("SAMPLE / DEMONSTRATION CONTENT");

  await page.getByRole("button", { name: "Draft with AI assistance" }).click();
  // #3: acknowledge the disclosure before the drafting call runs.
  await page.getByRole("button", { name: "Send to AI assistance" }).click();
  await expect(page.getByText(/This draft was written with AI assistance/)).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByText(/Nothing has been sent\./)).toBeVisible();
  // The sample label survives assistance exactly as in the template.
  await expect(body).toContainText("SAMPLE / DEMONSTRATION CONTENT");

  const drafted = await body.inputValue();
  // Same reason as the extraction log: show what the metered call returned.
  // eslint-disable-next-line no-console
  console.log(
    `[e2e] live draft subject: ${await page.getByLabel("Subject").inputValue()} | body ${drafted.length} chars`,
  );
  await body.fill(`${drafted}\nChecked and edited by the reporter.`);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Saved to the demo service.")).toBeVisible();
  await expect(page.getByText(/A draft for this channel is saved \(assisted/)).toBeVisible();

  expect(await savedDraftMethod(assistedReportId as string, "brand")).toBe("assisted");
});

test("an unavailable extraction keeps the typed wording and manual confirmation still works", async ({
  page,
}) => {
  await signIn(page);
  manualReportId = await createReport(page, "Sample Pantry Corn Rings");
  await attachLabelPhoto(page, manualReportId);
  await routeEnvelope(
    page,
    "**/api/reports/*/ai/extract",
    503,
    "DEPENDENCY_UNAVAILABLE",
    "AI assistance is unavailable.",
  );

  await page.goto(`/pilot/reports/${manualReportId}/edit`);
  await page.getByRole("button", { name: "3 Concern" }).click();
  await page
    .getByLabel("Your concern")
    .fill("The sample pack claims gluten-free while the ingredients list wheat starch.");
  await page.getByLabel("Gluten-free wording on the label").fill("Gluten free — typed by hand");
  await page.getByLabel("Ingredient wording").fill("Wheat starch, sugar, salt");

  await page.getByRole("button", { name: "Suggest wording from my photos" }).click();
  await page.getByRole("button", { name: "Send to AI assistance" }).click();
  await expect(page.getByText(UNAVAILABLE)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Suggested text — check against your photo" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Gluten-free wording on the label")).toHaveValue(
    "Gluten free — typed by hand",
  );

  await page.getByRole("button", { name: "I checked this wording against my photo" }).click();
  await expect(page.getByText(/^You confirmed this wording on/)).toBeVisible();
  expect(await newestConfirmationMethod(manualReportId)).toBe("manual");
});

test("an unavailable draft leaves the template alone and saving still records template", async ({
  page,
}) => {
  test.skip(!manualReportId, "depends on the report confirmed above");
  await signIn(page);
  await routeEnvelope(
    page,
    "**/api/reports/*/ai/draft",
    503,
    "DEPENDENCY_UNAVAILABLE",
    "AI assistance is unavailable.",
  );

  await page.goto(`/pilot/reports/${manualReportId}/actions`);
  const body = page.getByLabel("Message", { exact: true });
  await expect(body).toContainText("SAMPLE / DEMONSTRATION CONTENT");
  const template = await body.inputValue();

  await page.getByRole("button", { name: "Draft with AI assistance" }).click();
  await page.getByRole("button", { name: "Send to AI assistance" }).click();
  await expect(page.getByText(UNAVAILABLE)).toBeVisible();
  await expect(body).toHaveValue(template);
  await expect(page.getByText(/This draft was written with AI assistance/)).toHaveCount(0);

  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Saved to the demo service.")).toBeVisible();
  await expect(page.getByText(/A draft for this channel is saved \(template/)).toBeVisible();
  expect(await savedDraftMethod(manualReportId as string, "brand")).toBe("template");
});

test("no assisted control exists anywhere when the backend is not configured", async ({ page }) => {
  test.skip(!manualReportId, "depends on the report seeded above");
  await signIn(page);
  // The real session body with the capability flag turned off — everything
  // else about the session stays exactly as the server reported it.
  await page.route("**/api/me", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.data.ai_available = false;
    await route.fulfill({ response, json });
  });

  await page.goto(`/pilot/reports/${manualReportId}/edit`);
  await page.getByRole("button", { name: "3 Concern" }).click();
  await expect(page.getByLabel("Gluten-free wording on the label")).toBeVisible();
  await expect(page.getByRole("button", { name: "Suggest wording from my photos" })).toHaveCount(0);

  await page.goto(`/pilot/reports/${manualReportId}/actions`);
  await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Draft with AI assistance" })).toHaveCount(0);
});

test("a rate-limited extraction shows the same honest line plus the wait", async ({ page }) => {
  test.skip(!manualReportId, "depends on the report seeded above");
  await signIn(page);
  await routeEnvelope(
    page,
    "**/api/reports/*/ai/extract",
    429,
    "RATE_LIMITED",
    "Too many assisted requests.",
    { "retry-after": "30" },
  );

  await page.goto(`/pilot/reports/${manualReportId}/edit`);
  await page.getByRole("button", { name: "3 Concern" }).click();
  const claim = page.getByLabel("Gluten-free wording on the label");
  const before = await claim.inputValue();

  await page.getByRole("button", { name: "Suggest wording from my photos" }).click();
  await page.getByRole("button", { name: "Send to AI assistance" }).click();
  await expect(page.getByText(UNAVAILABLE)).toBeVisible();
  await expect(page.getByText("Wait about 30 seconds before trying again.")).toBeVisible();
  await expect(claim).toHaveValue(before);
  await expect(
    page.getByRole("heading", { name: "Suggested text — check against your photo" }),
  ).toHaveCount(0);
});
