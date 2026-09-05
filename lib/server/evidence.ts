import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvidenceMeta, EvidenceRolesPatch, EvidenceUploadMeta } from "@/lib/contracts";
import { ApiError } from "./errors";
import { getServiceClient } from "./supabase";
import { loadOwnedReport } from "./data";
import { computePreparation, loadLabelRoles } from "./preparation";
import { evidenceStorage } from "./storage";
import { sniffMime } from "./image";
import { recordEvent } from "./audit";
import { withReceipt } from "./idempotency";

/**
 * Evidence write services (FOODPROOF_TECHNICAL_SPEC.md §5/§6,
 * FOODPROOF_API_DETAILS.md). Uploads are ownership-checked, size-capped and
 * content-sniffed (the client content-type is never trusted); only ready label
 * images with identity/claim/ingredients roles count toward readiness. Evidence
 * bytes live in private buckets and are served only through guarded media routes.
 */

export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const STALE = () =>
  new ApiError("CONFLICT", "This report changed since you loaded it. Reload and retry.");

function allowedTypesFor(kind: EvidenceUploadMeta["kind"]): string[] {
  return kind === "label" ? IMAGE_TYPES : [...IMAGE_TYPES, "application/pdf"];
}

function mapEvidence(row: Record<string, unknown>): EvidenceMeta {
  return {
    id: row.id as string,
    kind: row.kind as EvidenceMeta["kind"],
    roles: (row.roles as EvidenceMeta["roles"]) ?? [],
    mime_type: row.mime_type as string,
    bytes: Number(row.bytes),
    upload_state: row.upload_state as EvidenceMeta["upload_state"],
    created_at: row.created_at as string,
  };
}

/** True when the evidence is a selected source of a still-pending review request. */
async function isLockedByPendingReview(
  supabase: SupabaseClient,
  evidenceId: string,
): Promise<boolean> {
  const { data: assets, error } = await supabase
    .from("publication_assets")
    .select("revision_id")
    .eq("source_evidence_id", evidenceId);
  if (error) throw error;
  const revIds = (assets ?? []).map((a) => a.revision_id);
  if (revIds.length === 0) return false;
  const { data: pending, error: pErr } = await supabase
    .from("publication_revisions")
    .select("id")
    .in("id", revIds)
    .eq("state", "pending_review");
  if (pErr) throw pErr;
  return (pending ?? []).length > 0;
}

/** Bump report version + updated_at and persist recomputed preparation. */
async function refreshReportState(
  supabase: SupabaseClient,
  reportId: string,
  expectedVersion: number | null,
): Promise<void> {
  const { data: r, error } = await supabase
    .from("reports")
    .select("brand, product_name, concern_text, facts_confirmed_at, version")
    .eq("id", reportId)
    .single();
  if (error) throw error;
  if (expectedVersion !== null && r.version !== expectedVersion) throw STALE();

  const labelRoles = await loadLabelRoles(reportId, supabase);
  const preparation = computePreparation({
    brand: r.brand,
    productName: r.product_name,
    concernText: r.concern_text,
    factsConfirmedAt: r.facts_confirmed_at,
    labelRoles,
  });
  const { data: upd, error: uErr } = await supabase
    .from("reports")
    .update({ version: r.version + 1, updated_at: new Date().toISOString(), preparation })
    .eq("id", reportId)
    .eq("version", r.version)
    .select("id");
  if (uErr) throw uErr;
  if (!upd || upd.length === 0) throw STALE();
}

export async function addEvidence(
  accessId: string,
  reportId: string,
  meta: EvidenceUploadMeta,
  file: { bytes: Uint8Array },
  idempotencyKey: string,
): Promise<EvidenceMeta> {
  return withReceipt(
    accessId,
    "evidence.add",
    idempotencyKey,
    { reportId, kind: meta.kind, roles: meta.roles, size: file.bytes.length },
    async () => {
      const supabase = getServiceClient();
      await loadOwnedReport(accessId, reportId, supabase);

      if (file.bytes.length === 0) {
        throw new ApiError("VALIDATION_FAILED", "Empty file.");
      }
      if (file.bytes.length > MAX_UPLOAD_BYTES) {
        throw new ApiError("VALIDATION_FAILED", "File exceeds the 3 MB limit.");
      }
      const sniffed = sniffMime(file.bytes);
      if (!sniffed || !allowedTypesFor(meta.kind).includes(sniffed)) {
        throw new ApiError("VALIDATION_FAILED", "Unsupported or mismatched file type.", {
          fields: { file: `Allowed for ${meta.kind}: ${allowedTypesFor(meta.kind).join(", ")}.` },
        });
      }
      const roles = meta.kind === "label" ? meta.roles : [];
      if (meta.kind !== "label" && meta.roles.length > 0) {
        throw new ApiError("VALIDATION_FAILED", "Roles apply only to label evidence.");
      }

      const stored = await evidenceStorage.putOriginal(reportId, {
        bytes: file.bytes,
        mimeType: sniffed,
      });

      const { data, error } = await supabase
        .from("evidence")
        .insert({
          report_id: reportId,
          object_path: stored.objectPath,
          kind: meta.kind,
          roles,
          mime_type: sniffed,
          bytes: stored.bytes,
          upload_state: "ready",
        })
        .select("*")
        .single();
      if (error) {
        // The row failed after the object landed: clean up the orphan bytes.
        await evidenceStorage.removeOriginal(stored.objectPath).catch(() => undefined);
        throw error;
      }

      await refreshReportState(supabase, reportId, null);
      await recordEvent({
        reportId,
        actorAccessId: accessId,
        type: "evidence_added",
        relatedEntityId: data.id,
        metadata: { kind: meta.kind },
      });
      return mapEvidence(data);
    },
  );
}

async function loadOwnedEvidence(
  supabase: SupabaseClient,
  accessId: string,
  evidenceId: string,
): Promise<{ evidence: Record<string, unknown>; reportId: string }> {
  const { data, error } = await supabase
    .from("evidence")
    .select("*")
    .eq("id", evidenceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError("NOT_FOUND", "Evidence not found.");
  // Assert ownership of the parent report (NOT_FOUND hides other owners).
  await loadOwnedReport(accessId, data.report_id, supabase);
  return { evidence: data, reportId: data.report_id };
}

export async function patchEvidenceRoles(
  accessId: string,
  evidenceId: string,
  patch: EvidenceRolesPatch,
  idempotencyKey: string,
): Promise<EvidenceMeta> {
  if (patch.report_expected_version === null) {
    throw new ApiError("VALIDATION_FAILED", "report_expected_version is required.");
  }
  return withReceipt(
    accessId,
    "evidence.roles",
    idempotencyKey,
    { evidenceId, roles: patch.roles },
    async () => {
      const supabase = getServiceClient();
      const { evidence, reportId } = await loadOwnedEvidence(supabase, accessId, evidenceId);

      if (evidence.kind !== "label" && patch.roles.length > 0) {
        throw new ApiError("VALIDATION_FAILED", "Roles apply only to label evidence.");
      }
      if (await isLockedByPendingReview(supabase, evidenceId)) {
        throw new ApiError(
          "CONFLICT",
          "Withdraw the pending review request before changing this evidence.",
        );
      }

      const { error } = await supabase
        .from("evidence")
        .update({ roles: patch.roles })
        .eq("id", evidenceId);
      if (error) throw error;

      await refreshReportState(supabase, reportId, patch.report_expected_version);
      await recordEvent({
        reportId,
        actorAccessId: accessId,
        type: "evidence_roles_changed",
        relatedEntityId: evidenceId,
      });

      const { data: fresh, error: fErr } = await supabase
        .from("evidence")
        .select("*")
        .eq("id", evidenceId)
        .single();
      if (fErr) throw fErr;
      return mapEvidence(fresh);
    },
  );
}

export async function removeEvidence(
  accessId: string,
  evidenceId: string,
  idempotencyKey: string,
): Promise<{ evidence_id: string; removed: true }> {
  return withReceipt(
    accessId,
    "evidence.remove",
    idempotencyKey,
    { evidenceId },
    async () => {
      const supabase = getServiceClient();
      const { evidence, reportId } = await loadOwnedEvidence(supabase, accessId, evidenceId);

      if (await isLockedByPendingReview(supabase, evidenceId)) {
        throw new ApiError(
          "CONFLICT",
          "Withdraw the pending review request before removing this evidence.",
        );
      }

      const { error } = await supabase.from("evidence").delete().eq("id", evidenceId);
      if (error) {
        // Referenced by a recorded submission/update acknowledgement.
        if ((error as { code?: string }).code === "23503") {
          throw new ApiError(
            "CONFLICT",
            "This file is attached to a recorded submission or update.",
          );
        }
        throw error;
      }
      // Remove the private original; published reviewed copies are never deleted here.
      await evidenceStorage
        .removeOriginal(evidence.object_path as string)
        .catch(() => undefined);

      await refreshReportState(supabase, reportId, null);
      await recordEvent({
        reportId,
        actorAccessId: accessId,
        type: "evidence_removed",
        relatedEntityId: evidenceId,
      });
      return { evidence_id: evidenceId, removed: true };
    },
  );
}

/**
 * Read evidence bytes for the guarded media route: owner, or a reviewer while
 * the report has a pending review case. Never returns a public URL.
 */
export async function readEvidenceForMedia(
  actor: { accessId: string; role: "user" | "reviewer" },
  evidenceId: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const supabase = getServiceClient();
  const { data: evidence, error } = await supabase
    .from("evidence")
    .select("object_path, mime_type, report_id")
    .eq("id", evidenceId)
    .maybeSingle();
  if (error) throw error;
  if (!evidence) throw new ApiError("NOT_FOUND", "Evidence not found.");

  const { data: report, error: rErr } = await supabase
    .from("reports")
    .select("owner_access_id")
    .eq("id", evidence.report_id)
    .single();
  if (rErr) throw rErr;

  let permitted = report.owner_access_id === actor.accessId;
  if (!permitted && actor.role === "reviewer") {
    const { data: pending, error: pErr } = await supabase
      .from("publication_revisions")
      .select("id")
      .eq("report_id", evidence.report_id)
      .eq("state", "pending_review")
      .limit(1);
    if (pErr) throw pErr;
    permitted = (pending ?? []).length > 0;
  }
  if (!permitted) throw new ApiError("NOT_FOUND", "Evidence not found.");

  const bytes = await evidenceStorage.readBytes(evidence.object_path as string);
  return { bytes, mimeType: evidence.mime_type as string };
}
