import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { createInvitation, deleteInvitations, enterPilot, type CreatedInvitation } from "./helpers";
import { E2E_ORIGIN } from "./origin";

/**
 * Action preparation and handoff — docs/FOODPROOF_SCREENS.md §7.
 * Asserts the distinctions the pilot depends on: preparing is not saving,
 * copying is not sending, opening a destination is not submitting, and
 * recording a submission is the reporter's own note.
 */

test.describe.configure({ mode: "serial" });

const accessIds: string[] = [];
let invitation: CreatedInvitation | null = null;
let readyReportId: string | null = null;
let draftReportId: string | null = null;

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

/** A report the server itself calls ready, built through the real API. */
async function seedReadyReport(page: Page): Promise<string> {
  const request = page.request;
  const headers = (key: string) => ({ Origin: E2E_ORIGIN, "Idempotency-Key": key });
  const created = await ok(request, "post", "/api/reports", {
    headers: headers(uuid()),
    data: { product_name: "Sample Pantry Millet Puffs", brand: "Sample Pantry", expected_version: null },
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
      product_name: "Sample Pantry Millet Puffs",
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

test.afterAll(async () => {
  await deleteInvitations(accessIds);
  accessIds.length = 0;
  invitation = null;
  readyReportId = null;
  draftReportId = null;
});

test("without confirmed facts the screen explains why there is no draft", async ({ page }) => {
  await signIn(page);
  const draft = await ok(page.request, "post", "/api/reports", {
    headers: { Origin: E2E_ORIGIN, "Idempotency-Key": uuid() },
    data: { product_name: "Sample Pantry Corn Rings", brand: "Sample Pantry", expected_version: null },
  });
  draftReportId = draft.report_id as string;

  await page.goto(`/pilot/reports/${draftReportId}/actions`);
  await expect(page.getByRole("heading", { name: "Confirm your label facts first" })).toBeVisible();
  await expect(page.getByLabel("Message", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Confirm the label facts" })).toBeVisible();
});

test("prepares a deterministic template that tells testers not to send it", async ({ page }) => {
  await signIn(page);
  readyReportId = await seedReadyReport(page);

  await page.goto(`/pilot/reports/${readyReportId}/actions`);
  await expect(page.getByRole("heading", { name: "Brand message" })).toBeVisible();
  const body = page.getByLabel("Message", { exact: true });
  await expect(body).toContainText("SAMPLE / DEMONSTRATION CONTENT");
  await expect(body).toContainText("Do not send it to any real brand or authority.");
  await expect(body).toContainText("Wheat starch, sugar, salt");
  await expect(
    page.getByText("Do not send these practice messages to a real brand or a real authority."),
  ).toBeVisible();
  // The pilot exercise is fictional; the screen says so before anything else.
  await expect(page.getByText("Supplied Label claim you confirmed: Gluten free")).toBeVisible();
});

test("saves an edited draft and the saved text comes back", async ({ page }) => {
  test.skip(!readyReportId, "depends on the seeded report");
  await signIn(page);
  await page.goto(`/pilot/reports/${readyReportId}/actions`);

  const body = page.getByLabel("Message", { exact: true });
  await body.fill("Edited practice message. Fictional demo content — do not send.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Saved to the demo service.")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    "Edited practice message. Fictional demo content — do not send.",
  );
  await expect(page.getByText(/A draft for this channel is saved/)).toBeVisible();
});

test("copying confirms a copy and never claims a send", async ({ page, context }) => {
  test.skip(!readyReportId, "depends on the seeded report");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page);
  await page.goto(`/pilot/reports/${readyReportId}/actions`);

  await page.getByRole("button", { name: "Copy message" }).click();
  await expect(page.getByText("Copying is not sending", { exact: false })).toBeVisible();
});

test("the official channel offers no working portal handoff yet", async ({ page }) => {
  test.skip(!readyReportId, "depends on the seeded report");
  await signIn(page);
  await page.goto(`/pilot/reports/${readyReportId}/actions`);

  await page.getByRole("button", { name: "Official complaint" }).click();
  await expect(page.getByRole("heading", { name: "Official complaint" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open official portal" })).toBeDisabled();
  await expect(page.getByText("Official destination not configured.")).toBeVisible();
});

test("recording a submission is a separate, deliberate step", async ({ page }) => {
  test.skip(!readyReportId, "depends on the seeded report");
  await signIn(page);
  await page.goto(`/pilot/reports/${readyReportId}/actions`);

  await expect(page.getByText("0 submissions recorded by you on this channel.")).toBeVisible();
  await page.getByRole("button", { name: "Record that you sent it" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Who you sent it to").fill("Sample Pantry consumer care");
  await dialog.getByRole("button", { name: "Save submission record" }).click();

  await expect(page.getByText("1 submission recorded by you on this channel.")).toBeVisible();
});
