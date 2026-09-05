import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { E2E_ORIGIN } from "./origin";
import { createInvitation, deleteInvitations, enterPilot } from "./helpers";
import { samplePng } from "../helpers/sample-image";

/**
 * Browser-level decode guard. The guarded media routes (`GET /api/evidence/:id`,
 * `GET /api/publication-assets/:id`) already return 200 with the right
 * Content-Type — that alone does not prove the served bytes are a decodable
 * image. This renders each evidence id as a real `<img>` in Chromium and
 * asserts `naturalWidth > 0`, which only happens once the browser has
 * successfully decoded the pixel data. This is exactly the regression the
 * previous fixture (hardcoded `0,0,0,0` chunk CRCs, a truncated IDAT) would
 * have failed: every route-level test still passed while every rendered
 * image was broken.
 *
 * Uses a throwaway `user` (and, for the publication case, `reviewer`)
 * invitation, deleted in `afterAll`. Skips (via helpers.ts's `createInvitation`)
 * with the missing variable name when live Supabase credentials are absent.
 */

const FICTIONAL_JPEG_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "design",
  "assets",
  "clear-signal-label-preview.jpg",
);

/** Render `src` as an `<img>` on the currently-loaded page and resolve its
 * `naturalWidth` once decoded (rejects on a decode/network failure). */
async function decodedWidth(page: Page, src: string): Promise<number> {
  return page.evaluate((imgSrc) => {
    return new Promise<number>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth);
      img.onerror = () => reject(new Error(`image failed to load/decode: ${imgSrc}`));
      img.src = imgSrc;
    });
  }, src);
}

const accessIds: string[] = [];
test.afterAll(async () => {
  await deleteInvitations(accessIds);
});

test.describe("media decode guard (served bytes must actually decode in the browser)", () => {
  test("a. uploaded PNG and fictional JPEG evidence both decode as real images", async ({ page }) => {
    const invite = await createInvitation("user");
    accessIds.push(invite.accessId);
    await enterPilot(page, invite.code);

    const createRes = await page.request.post("/api/reports", {
      headers: { Origin: E2E_ORIGIN, "Idempotency-Key": crypto.randomUUID() },
      data: {
        product_name: `Decode Guard Product ${Date.now()}`,
        brand: "Decode Guard Brand (fictional)",
        variant: null,
        observation_date: null,
        batch_number: null,
        concern_text: "SAMPLE: decode-guard fixture report, not a real complaint.",
        claim_text: null,
        ingredients_text: null,
        product_id: null,
        expected_version: null,
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const reportId: string = (await createRes.json()).data.report_id;

    const pngRes = await page.request.post(`/api/reports/${reportId}/evidence`, {
      headers: { Origin: E2E_ORIGIN, "Idempotency-Key": crypto.randomUUID() },
      multipart: {
        file: { name: "label.png", mimeType: "image/png", buffer: Buffer.from(samplePng()) },
        kind: "label",
        roles: JSON.stringify([]),
      },
    });
    expect(pngRes.ok()).toBeTruthy();
    const pngEvidenceId: string = (await pngRes.json()).data.id;

    const jpegBytes = readFileSync(FICTIONAL_JPEG_PATH);
    const jpegRes = await page.request.post(`/api/reports/${reportId}/evidence`, {
      headers: { Origin: E2E_ORIGIN, "Idempotency-Key": crypto.randomUUID() },
      multipart: {
        file: { name: "fictional-label.jpg", mimeType: "image/jpeg", buffer: jpegBytes },
        kind: "label",
        roles: JSON.stringify(["identity", "claim", "ingredients"]),
      },
    });
    expect(jpegRes.ok()).toBeTruthy();
    const jpegEvidenceId: string = (await jpegRes.json()).data.id;

    // A same-origin document is required so the relative <img> src carries the
    // session cookie (images send credentials on same-origin requests by default).
    await page.goto("/");

    expect(await decodedWidth(page, `/api/evidence/${pngEvidenceId}`)).toBeGreaterThan(0);
    expect(await decodedWidth(page, `/api/evidence/${jpegEvidenceId}`)).toBeGreaterThan(0);
  });

  test("b. the reviewed (metadata-stripped) JPEG copy still decodes once published", async ({
    page,
    browser,
  }) => {
    const userInvite = await createInvitation("user");
    const reviewerInvite = await createInvitation("reviewer");
    accessIds.push(userInvite.accessId, reviewerInvite.accessId);
    await enterPilot(page, userInvite.code);

    const createRes = await page.request.post("/api/reports", {
      headers: { Origin: E2E_ORIGIN, "Idempotency-Key": crypto.randomUUID() },
      data: {
        product_name: `Decode Guard Publication ${Date.now()}`,
        brand: "Decode Guard Brand (fictional)",
        variant: null,
        observation_date: null,
        batch_number: null,
        concern_text: "SAMPLE: decode-guard publication fixture, not a real complaint.",
        claim_text: null,
        ingredients_text: null,
        product_id: null,
        expected_version: null,
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const reportId: string = (await createRes.json()).data.report_id;

    const jpegBytes = readFileSync(FICTIONAL_JPEG_PATH);
    const uploadRes = await page.request.post(`/api/reports/${reportId}/evidence`, {
      headers: { Origin: E2E_ORIGIN, "Idempotency-Key": crypto.randomUUID() },
      multipart: {
        file: { name: "fictional-label.jpg", mimeType: "image/jpeg", buffer: jpegBytes },
        kind: "label",
        roles: JSON.stringify(["identity", "claim", "ingredients"]),
      },
    });
    expect(uploadRes.ok()).toBeTruthy();
    const evidenceId: string = (await uploadRes.json()).data.id;

    const afterUpload = await (await page.request.get(`/api/reports/${reportId}`)).json();
    const confirmRes = await page.request.post(`/api/reports/${reportId}/confirm-facts`, {
      headers: { Origin: E2E_ORIGIN, "Idempotency-Key": crypto.randomUUID() },
      data: {
        expected_version: afterUpload.data.version,
        claim_text: "Gluten-free (front of pack)",
        ingredients_text: "Rice flour, water, salt",
        method: "manual",
      },
    });
    expect(confirmRes.ok()).toBeTruthy();
    const confirmed = (await confirmRes.json()).data;

    const pubReqRes = await page.request.post(`/api/reports/${reportId}/publication-requests`, {
      headers: { Origin: E2E_ORIGIN, "Idempotency-Key": crypto.randomUUID() },
      data: {
        expected_version: confirmed.version,
        consent: true,
        selected_evidence_ids: [evidenceId],
      },
    });
    expect(pubReqRes.ok()).toBeTruthy();
    const revisionId: string = (await pubReqRes.json()).data.publication_revision_id;

    const reviewerContext = await browser.newContext();
    const reviewerPage = await reviewerContext.newPage();
    await enterPilot(reviewerPage, reviewerInvite.code);

    const detailRes = await reviewerPage.request.get(`/api/review/${revisionId}`);
    expect(detailRes.ok()).toBeTruthy();
    const detail = (await detailRes.json()).data;

    const decisionRes = await reviewerPage.request.post(`/api/review/${revisionId}/decision`, {
      headers: { Origin: E2E_ORIGIN, "Idempotency-Key": crypto.randomUUID() },
      data: { expected_version: detail.version, action: "approve" },
    });
    expect(decisionRes.ok()).toBeTruthy();
    await reviewerContext.close();

    const feedDetailRes = await page.request.get(`/api/feed/${reportId}`);
    expect(feedDetailRes.ok()).toBeTruthy();
    const assetId: string = (await feedDetailRes.json()).data.approved_asset_ids[0];
    expect(assetId).toBeTruthy();

    await page.goto("/");
    expect(await decodedWidth(page, `/api/publication-assets/${assetId}`)).toBeGreaterThan(0);
  });
});
