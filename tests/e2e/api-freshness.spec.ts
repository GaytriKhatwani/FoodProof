import { test, expect, type APIRequestContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { E2E_ORIGIN } from "./origin";
import { createInvitation, deleteInvitations, enterPilot } from "./helpers";
import { samplePng } from "../helpers/sample-image";

/**
 * Regression coverage for the Next.js Data Cache defect: every Supabase READ
 * made inside a route handler must reflect the most recent write on the very
 * next request. `export const dynamic = "force-dynamic"` disables ROUTE
 * caching but does NOT, by itself, stop Next's patched global `fetch` from
 * storing the underlying PostgREST/Storage GET in the fetch Data Cache — so
 * this must be exercised through the real Next runtime (a live `next dev`
 * server), never by calling the service functions directly.
 *
 * Skips (never fails) with the missing variable name when live Supabase
 * credentials are absent, matching tests/e2e/helpers.ts's own gate.
 */

const SUPABASE_URL_VAR = "SUPABASE_URL";

function missingLiveCredential(): string | null {
  if (!process.env[SUPABASE_URL_VAR]) return SUPABASE_URL_VAR;
  if (!process.env.SUPABASE_SECRET_KEY) return "SUPABASE_SECRET_KEY";
  return null;
}

const missing = missingLiveCredential();
test.skip(
  Boolean(missing),
  `Missing live credential: ${missing}. Set SUPABASE_URL / SUPABASE_SECRET_KEY in .env.local.`,
);

function directClient() {
  return createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SECRET_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

const sha256Hex = (v: string) => createHash("sha256").update(v).digest("hex");

/** Directly flip a session's analytics_consent column, bypassing the app entirely. */
async function flipConsentDirectly(rawToken: string, value: boolean): Promise<void> {
  const supabase = directClient();
  const { error } = await supabase
    .from("demo_sessions")
    .update({ analytics_consent: value })
    .eq("token_hash", sha256Hex(rawToken));
  if (error) throw new Error(`direct consent flip failed: ${error.message}`);
}

/** Read the raw session cookie value Playwright's context is holding. */
async function sessionCookieValue(request: APIRequestContext): Promise<string> {
  const state = await request.storageState();
  const cookie = state.cookies.find((c) => c.name === "fp_session" || c.name.includes("session"));
  if (!cookie) throw new Error("No session cookie found in storage state.");
  return cookie.value;
}

const accessIds: string[] = [];
test.afterAll(async () => {
  await deleteInvitations(accessIds);
});

test.describe("API freshness (Next Data Cache must never serve stale Supabase reads)", () => {
  test("a. consent PUT is immediately visible on the next GET /api/me", async ({ page }) => {
    const invite = await createInvitation("user");
    accessIds.push(invite.accessId);
    await enterPilot(page, invite.code);

    const before = await page.request.get("/api/me");
    expect(before.ok()).toBeTruthy();
    expect((await before.json()).data.analytics_consent).toBe(false);

    const putTrue = await page.request.put("/api/me/analytics-consent", {
      headers: { Origin: E2E_ORIGIN },
      data: { allowed: true },
    });
    expect(putTrue.ok()).toBeTruthy();

    const afterTrue = await page.request.get("/api/me");
    expect(afterTrue.ok()).toBeTruthy();
    expect((await afterTrue.json()).data.analytics_consent).toBe(true);

    const putFalse = await page.request.put("/api/me/analytics-consent", {
      headers: { Origin: E2E_ORIGIN },
      data: { allowed: false },
    });
    expect(putFalse.ok()).toBeTruthy();

    const afterFalse = await page.request.get("/api/me");
    expect(afterFalse.ok()).toBeTruthy();
    expect((await afterFalse.json()).data.analytics_consent).toBe(false);
  });

  test("b. a write made directly in Postgres is visible on the next GET /api/me", async ({ page }) => {
    const invite = await createInvitation("user");
    accessIds.push(invite.accessId);
    await enterPilot(page, invite.code);

    const first = await page.request.get("/api/me");
    expect(first.ok()).toBeTruthy();
    expect((await first.json()).data.analytics_consent).toBe(false);

    const rawToken = await sessionCookieValue(page.request);
    await flipConsentDirectly(rawToken, true);

    const second = await page.request.get("/api/me");
    expect(second.ok()).toBeTruthy();
    expect((await second.json()).data.analytics_consent).toBe(true);

    // Flip back and confirm again, proving it isn't a one-shot fluke.
    await flipConsentDirectly(rawToken, false);
    const third = await page.request.get("/api/me");
    expect(third.ok()).toBeTruthy();
    expect((await third.json()).data.analytics_consent).toBe(false);
  });

  test("c. an approval is visible in the feed on the very next GET /api/feed; withdrawal removes it on the next request", async ({
    page,
    browser,
  }) => {
    const userInvite = await createInvitation("user");
    const reviewerInvite = await createInvitation("reviewer");
    accessIds.push(userInvite.accessId, reviewerInvite.accessId);

    await enterPilot(page, userInvite.code);

    // 1. Create a report with a concern (required for readiness later).
    const createRes = await page.request.post("/api/reports", {
      headers: { Origin: E2E_ORIGIN, "Idempotency-Key": crypto.randomUUID() },
      data: {
        product_name: `Freshness Test Product ${Date.now()}`,
        brand: "Freshness Test Brand",
        variant: null,
        observation_date: null,
        batch_number: null,
        concern_text: "Found wheat traces despite gluten-free labeling.",
        claim_text: null,
        ingredients_text: null,
        product_id: null,
        expected_version: null,
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const report = (await createRes.json()).data;
    const reportId: string = report.report_id;

    // 2. Upload one label image covering all three roles.
    const uploadRes = await page.request.post(`/api/reports/${reportId}/evidence`, {
      headers: { Origin: E2E_ORIGIN, "Idempotency-Key": crypto.randomUUID() },
      multipart: {
        file: { name: "label.png", mimeType: "image/png", buffer: Buffer.from(samplePng()) },
        kind: "label",
        roles: JSON.stringify(["identity", "claim", "ingredients"]),
      },
    });
    expect(uploadRes.ok()).toBeTruthy();
    const evidence = (await uploadRes.json()).data;

    // 3. Re-fetch the report to get the post-upload version, then confirm facts.
    const afterUpload = await (await page.request.get(`/api/reports/${reportId}`)).json();
    const confirmRes = await page.request.post(`/api/reports/${reportId}/confirm-facts`, {
      headers: { Origin: E2E_ORIGIN, "Idempotency-Key": crypto.randomUUID() },
      data: {
        expected_version: afterUpload.data.version,
        claim_text: "Certified gluten-free",
        ingredients_text: "Rice flour, water, salt",
        method: "manual",
      },
    });
    expect(confirmRes.ok()).toBeTruthy();
    const confirmed = (await confirmRes.json()).data;

    // 4. Request publication with consent and the evidence id.
    const pubReqRes = await page.request.post(`/api/reports/${reportId}/publication-requests`, {
      headers: { Origin: E2E_ORIGIN, "Idempotency-Key": crypto.randomUUID() },
      data: {
        expected_version: confirmed.version,
        consent: true,
        selected_evidence_ids: [evidence.id],
      },
    });
    expect(pubReqRes.ok()).toBeTruthy();
    const revisionId: string = (await pubReqRes.json()).data.publication_revision_id;

    // 5. GET /api/feed as the user before approval: the concern must be absent.
    const feedBefore = await page.request.get("/api/feed");
    expect(feedBefore.ok()).toBeTruthy();
    const feedBeforeItems: Array<{ report_id: string }> = (await feedBefore.json()).data.items;
    expect(feedBeforeItems.some((i) => i.report_id === reportId)).toBe(false);

    // 6. Approve as a reviewer, in a separate browser context (separate cookie jar).
    const reviewerContext = await browser.newContext();
    const reviewerPage = await reviewerContext.newPage();
    await enterPilot(reviewerPage, reviewerInvite.code);

    const queueRes = await reviewerPage.request.get("/api/review/queue");
    expect(queueRes.ok()).toBeTruthy();
    const queueItems: Array<{ publication_revision_id: string }> = (await queueRes.json()).data.items;
    expect(queueItems.some((i) => i.publication_revision_id === revisionId)).toBe(true);

    const detailRes = await reviewerPage.request.get(`/api/review/${revisionId}`);
    expect(detailRes.ok()).toBeTruthy();
    const detail = (await detailRes.json()).data;

    const decisionRes = await reviewerPage.request.post(`/api/review/${revisionId}/decision`, {
      headers: { Origin: E2E_ORIGIN, "Idempotency-Key": crypto.randomUUID() },
      data: { expected_version: detail.version, action: "approve" },
    });
    expect(decisionRes.ok()).toBeTruthy();
    await reviewerContext.close();

    // 7. GET /api/feed as the user again, right after approval: it must be present.
    const feedAfter = await page.request.get("/api/feed");
    expect(feedAfter.ok()).toBeTruthy();
    const feedAfterItems: Array<{ report_id: string }> = (await feedAfter.json()).data.items;
    expect(feedAfterItems.some((i) => i.report_id === reportId)).toBe(true);

    // 8. Grab the detail (and one of its approved asset ids) before withdrawal.
    const detailBefore = await page.request.get(`/api/feed/${reportId}`);
    expect(detailBefore.ok()).toBeTruthy();
    const detailBeforeBody = await detailBefore.json();
    const assetId: string = detailBeforeBody.data.approved_asset_ids[0];
    expect(assetId).toBeTruthy();

    const assetBeforeRes = await page.request.get(`/api/publication-assets/${assetId}`);
    expect(assetBeforeRes.ok()).toBeTruthy();

    // 9. Withdraw, then confirm both the feed detail and the asset stop serving
    // on the very next request.
    const withdrawRes = await page.request.post(`/api/reports/${reportId}/withdraw`, {
      headers: { Origin: E2E_ORIGIN, "Idempotency-Key": crypto.randomUUID() },
    });
    expect(withdrawRes.ok()).toBeTruthy();

    const detailAfter = await page.request.get(`/api/feed/${reportId}`);
    expect(detailAfter.status()).toBe(404);

    const assetAfterRes = await page.request.get(`/api/publication-assets/${assetId}`);
    expect(assetAfterRes.status()).toBe(404);
  });
});
