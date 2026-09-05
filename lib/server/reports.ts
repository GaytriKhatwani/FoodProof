import "server-only";
import type {
  ConfirmFactsRequest,
  ReportDetail,
  ReportWriteRequest,
} from "@/lib/contracts";
import { ApiError } from "./errors";
import { getServiceClient } from "./supabase";
import { getOwnReport, loadOwnedReport } from "./data";
import { computePreparation, loadLabelRoles } from "./preparation";
import { recordEvent } from "./audit";
import { withReceipt } from "./idempotency";

/**
 * Report write services (FOODPROOF_TECHNICAL_SPEC.md §4/§6,
 * FOODPROOF_API_DETAILS.md). Ownership is resolved server-side; lifecycle,
 * publication, `preparation` and `facts_confirmed_at` are never set through a
 * generic write. Optimistic `expected_version` guards concurrent edits and an
 * idempotency receipt dedupes retries.
 */

const STALE = () =>
  new ApiError("CONFLICT", "This report changed since you loaded it. Reload and retry.");

async function assertProductExists(productId: string): Promise<void> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("products")
    .select("id")
    .eq("id", productId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new ApiError("VALIDATION_FAILED", "Unknown product.", {
      fields: { product_id: "No such product." },
    });
  }
}

export async function createReport(
  accessId: string,
  body: ReportWriteRequest,
  idempotencyKey: string,
): Promise<ReportDetail> {
  if (body.expected_version !== null) {
    throw new ApiError("VALIDATION_FAILED", "expected_version must be null when creating.", {
      fields: { expected_version: "Must be null on create." },
    });
  }
  return withReceipt(accessId, "report.create", idempotencyKey, body, async () => {
    const supabase = getServiceClient();
    if (body.product_id) await assertProductExists(body.product_id);
    const { data, error } = await supabase
      .from("reports")
      .insert({
        owner_access_id: accessId,
        product_name: body.product_name,
        brand: body.brand,
        variant: body.variant ?? null,
        observation_date: body.observation_date ?? null,
        batch_number: body.batch_number ?? null,
        concern_text: body.concern_text ?? null,
        claim_text: body.claim_text ?? null,
        ingredients_text: body.ingredients_text ?? null,
        product_id: body.product_id ?? null,
        preparation: "draft",
        lifecycle: "open",
        version: 0,
      })
      .select("id")
      .single();
    if (error) throw error;
    await recordEvent({ reportId: data.id, actorAccessId: accessId, type: "report_created" });
    return getOwnReport(accessId, data.id, supabase);
  });
}

export async function patchReport(
  accessId: string,
  reportId: string,
  body: ReportWriteRequest,
  idempotencyKey: string,
): Promise<ReportDetail> {
  if (body.expected_version === null) {
    throw new ApiError("VALIDATION_FAILED", "expected_version is required to update.", {
      fields: { expected_version: "Required for updates." },
    });
  }
  return withReceipt(
    accessId,
    "report.patch",
    idempotencyKey,
    { reportId, body },
    async () => {
      const supabase = getServiceClient();
      const current = await loadOwnedReport(accessId, reportId, supabase);
      if (body.expected_version !== current.version) throw STALE();
      if (body.product_id) await assertProductExists(body.product_id);

      const pick = <T>(v: T | undefined, fallback: T): T => (v === undefined ? fallback : v);
      const merged = {
        product_name: body.product_name,
        brand: body.brand,
        variant: pick(body.variant, current.variant),
        observation_date: pick(body.observation_date, current.observation_date),
        batch_number: pick(body.batch_number, current.batch_number),
        concern_text: pick(body.concern_text, current.concern_text),
        claim_text: pick(body.claim_text, current.claim_text),
        ingredients_text: pick(body.ingredients_text, current.ingredients_text),
        product_id: pick(body.product_id, current.product_id),
      };

      // Changing confirmed label facts clears confirmation and recomputes readiness.
      const factsCleared =
        (body.claim_text !== undefined && body.claim_text !== current.claim_text) ||
        (body.ingredients_text !== undefined &&
          body.ingredients_text !== current.ingredients_text);
      const factsConfirmedAt = factsCleared ? null : current.facts_confirmed_at;

      const labelRoles = await loadLabelRoles(reportId, supabase);
      const preparation = computePreparation({
        brand: merged.brand,
        productName: merged.product_name,
        concernText: merged.concern_text,
        factsConfirmedAt,
        labelRoles,
      });

      const { data: updated, error } = await supabase
        .from("reports")
        .update({
          ...merged,
          facts_confirmed_at: factsConfirmedAt,
          preparation,
          version: current.version + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", reportId)
        .eq("owner_access_id", accessId)
        .eq("version", current.version)
        .select("id");
      if (error) throw error;
      if (!updated || updated.length === 0) throw STALE();

      await recordEvent({ reportId, actorAccessId: accessId, type: "report_saved" });
      return getOwnReport(accessId, reportId, supabase);
    },
  );
}

export async function confirmFacts(
  accessId: string,
  reportId: string,
  body: ConfirmFactsRequest,
  idempotencyKey: string,
): Promise<ReportDetail> {
  return withReceipt(
    accessId,
    "report.confirm-facts",
    idempotencyKey,
    { reportId, body },
    async () => {
      const supabase = getServiceClient();
      const current = await loadOwnedReport(accessId, reportId, supabase);
      if (body.expected_version !== current.version) throw STALE();

      const nowIso = new Date().toISOString();
      const labelRoles = await loadLabelRoles(reportId, supabase);
      const preparation = computePreparation({
        brand: current.brand,
        productName: current.product_name,
        concernText: current.concern_text,
        factsConfirmedAt: nowIso,
        labelRoles,
      });

      const { data: updated, error } = await supabase
        .from("reports")
        .update({
          claim_text: body.claim_text,
          ingredients_text: body.ingredients_text,
          facts_confirmed_at: nowIso,
          preparation,
          version: current.version + 1,
          updated_at: nowIso,
        })
        .eq("id", reportId)
        .eq("owner_access_id", accessId)
        .eq("version", current.version)
        .select("id");
      if (error) throw error;
      if (!updated || updated.length === 0) throw STALE();

      await recordEvent({
        reportId,
        actorAccessId: accessId,
        type: "facts_confirmed",
        metadata: { method: body.method },
      });
      return getOwnReport(accessId, reportId, supabase);
    },
  );
}
