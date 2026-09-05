import { afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { ReportWriteRequest } from "@/lib/contracts";
import { ApiError } from "@/lib/server/errors";
import { createReport, patchReport, confirmFacts } from "@/lib/server/reports";
import { getOwnReport, listOwnReports } from "@/lib/server/data";
import {
  matchProducts,
  resolveOrCreateProduct,
} from "@/lib/server/products";
import { createAccess, deleteAccess, liveDescribe, testClient } from "../helpers/live";

/**
 * Report CRUD, ownership isolation, optimistic concurrency, idempotency and
 * server-derived preparation (FOODPROOF_TECHNICAL_SPEC.md §4, FOODPROOF_API_DETAILS.md).
 */
liveDescribe("report persistence (live Supabase)", () => {
  const client = testClient();
  const createdAccess: string[] = [];
  const createdProducts: string[] = [];

  afterAll(async () => {
    if (createdProducts.length) {
      await client.from("products").delete().in("id", createdProducts);
    }
    await deleteAccess(client, createdAccess);
  });

  async function tester() {
    const a = await createAccess(client, { role: "user", label: "user@foodproof" });
    createdAccess.push(a.accessId);
    return a.accessId;
  }

  const baseReport = (): ReportWriteRequest => ({
    product_name: "Sample Pantry Crackers",
    brand: "Sample Pantry",
    variant: null,
    concern_text: "Label claims gluten-free but lists wheat.",
    claim_text: null,
    ingredients_text: null,
    expected_version: null,
  });

  async function expectApiError(p: Promise<unknown>): Promise<ApiError> {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      return e as ApiError;
    }
    throw new Error("expected an ApiError");
  }

  it("creates a private draft owned by the session actor", async () => {
    const accessId = await tester();
    const detail = await createReport(accessId, baseReport(), randomUUID());
    expect(detail.version).toBe(0);
    expect(detail.preparation).toBe("draft");
    expect(detail.lifecycle).toBe("open");
    expect(detail.community_visibility).toBe("private");
    expect(detail.concern_text).toContain("gluten-free");

    // Persists across a fresh read.
    const reloaded = await getOwnReport(accessId, detail.report_id);
    expect(reloaded.report_id).toBe(detail.report_id);
    expect(reloaded.concern_text).toBe(detail.concern_text);
  });

  it("isolates one tester's draft from another by guessed id", async () => {
    const a = await tester();
    const b = await tester();
    const detail = await createReport(a, baseReport(), randomUUID());

    // B cannot read A's report by id...
    const err = await expectApiError(getOwnReport(b, detail.report_id));
    expect(err.code).toBe("NOT_FOUND");
    // ...nor does it appear in B's own list.
    const bList = await listOwnReports(b, null);
    expect(bList.items.find((r) => r.report_id === detail.report_id)).toBeUndefined();
    // A sees it.
    const aList = await listOwnReports(a, null);
    expect(aList.items.find((r) => r.report_id === detail.report_id)).toBeDefined();
  });

  it("saves an edit and rejects a stale one (optimistic concurrency)", async () => {
    const accessId = await tester();
    const created = await createReport(accessId, baseReport(), randomUUID());

    const patched = await patchReport(
      accessId,
      created.report_id,
      { ...baseReport(), concern_text: "Updated concern text.", expected_version: 0 },
      randomUUID(),
    );
    expect(patched.version).toBe(1);
    expect(patched.concern_text).toBe("Updated concern text.");

    // A second edit with the now-stale version 0 conflicts.
    const err = await expectApiError(
      patchReport(
        accessId,
        created.report_id,
        { ...baseReport(), concern_text: "Racing edit.", expected_version: 0 },
        randomUUID(),
      ),
    );
    expect(err.code).toBe("CONFLICT");
    // The winning value survives.
    const reloaded = await getOwnReport(accessId, created.report_id);
    expect(reloaded.concern_text).toBe("Updated concern text.");
  });

  it("dedupes a retried create and rejects a reused key with a different body", async () => {
    const accessId = await tester();
    const key = randomUUID();
    const first = await createReport(accessId, baseReport(), key);
    const retry = await createReport(accessId, baseReport(), key);
    expect(retry.report_id).toBe(first.report_id);

    const list = await listOwnReports(accessId, null);
    expect(list.items.filter((r) => r.report_id === first.report_id)).toHaveLength(1);

    const err = await expectApiError(
      createReport(
        accessId,
        { ...baseReport(), brand: "Different Brand" },
        key,
      ),
    );
    expect(err.code).toBe("CONFLICT");
  });

  it("confirms facts, then clears confirmation when label facts change", async () => {
    const accessId = await tester();
    const created = await createReport(accessId, baseReport(), randomUUID());

    const confirmed = await confirmFacts(
      accessId,
      created.report_id,
      {
        expected_version: 0,
        claim_text: "Gluten-free",
        ingredients_text: "Wheat flour, water, salt",
        method: "manual",
      },
      randomUUID(),
    );
    expect(confirmed.facts_confirmed_at).not.toBeNull();
    expect(confirmed.version).toBe(1);
    // No ready label evidence yet, so still not publication-ready.
    expect(confirmed.preparation).toBe("draft");

    // Changing a confirmed label fact clears confirmation.
    const edited = await patchReport(
      accessId,
      created.report_id,
      { ...baseReport(), ingredients_text: "Rice flour, water, salt", expected_version: 1 },
      randomUUID(),
    );
    expect(edited.facts_confirmed_at).toBeNull();
  });

  it("matches products only on the exact canonical identity", async () => {
    const brand = `Brand ${randomUUID().slice(0, 8)}`;
    const name = "Rice Crackers";
    const productId = await resolveOrCreateProduct({ brand, name, variant: null });
    createdProducts.push(productId);

    // Case/whitespace-insensitive exact match.
    const hit = await matchProducts({ brand: `  ${brand.toUpperCase()}  `, name: "rice   crackers" });
    expect(hit.map((m) => m.product_id)).toContain(productId);

    // A different variant is a different identity.
    const miss = await matchProducts({ brand, name, variant: "Salted" });
    expect(miss.map((m) => m.product_id)).not.toContain(productId);

    // Re-resolving the same identity reuses the row (no duplicate).
    const again = await resolveOrCreateProduct({ brand, name, variant: null });
    expect(again).toBe(productId);
  });
});
