import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CommunityVisibility,
  ComplaintDraft,
  EvidenceMeta,
  ReportDetail,
  ReportSummary,
  ReportUpdate,
  ReviewRequestState,
  Submission,
} from "@/lib/contracts";
import { ApiError } from "./errors";
import { getServiceClient } from "./supabase";

/**
 * Guarded owner-facing read models (FOODPROOF_TECHNICAL_SPEC.md §6/§7,
 * FOODPROOF_API_DETAILS.md). Every read is scoped to the calling actor; the
 * reviewer has no generic "list all reports" call — only review-specific reads
 * (see review.ts). Guarded media IDs are returned, never storage paths.
 */

const PAGE_SIZE = 20;

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset)).toString("base64url");
}
function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  const n = Number(Buffer.from(cursor, "base64url").toString("utf8"));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Community-visibility badge per report, derived from the latest CONCERN
 * revision (source_update_id IS NULL) and the publication pointer. Never
 * recomputed from private tables into public badges.
 */
export async function deriveVisibilities(
  reportIds: string[],
  client?: SupabaseClient,
): Promise<Map<string, CommunityVisibility>> {
  const supabase = client ?? getServiceClient();
  const map = new Map<string, CommunityVisibility>();
  for (const id of reportIds) map.set(id, "private");
  if (reportIds.length === 0) return map;

  const { data: revs, error: revErr } = await supabase
    .from("publication_revisions")
    .select("report_id, state, revision")
    .is("source_update_id", null)
    .in("report_id", reportIds)
    .order("revision", { ascending: false });
  if (revErr) throw revErr;
  const latestState = new Map<string, string>();
  for (const r of revs ?? []) {
    if (!latestState.has(r.report_id)) latestState.set(r.report_id, r.state);
  }

  const { data: pubs, error: pubErr } = await supabase
    .from("publications")
    .select("report_id, visible")
    .in("report_id", reportIds);
  if (pubErr) throw pubErr;
  const pubVisible = new Map<string, boolean>();
  for (const p of pubs ?? []) pubVisible.set(p.report_id, p.visible);

  for (const id of reportIds) {
    if (pubVisible.has(id)) {
      map.set(
        id,
        pubVisible.get(id)
          ? "published"
          : latestState.get(id) === "removed"
            ? "removed"
            : "withdrawn",
      );
      continue;
    }
    const st = latestState.get(id);
    switch (st) {
      case "pending_review":
      case "changes_requested":
      case "rejected":
      case "withdrawn":
      case "removed":
        map.set(id, st);
        break;
      default:
        map.set(id, "private");
    }
  }
  return map;
}

interface ReportRow {
  id: string;
  product_id: string | null;
  product_name: string;
  brand: string;
  variant: string | null;
  concern_text: string | null;
  claim_text: string | null;
  ingredients_text: string | null;
  facts_confirmed_at: string | null;
  observation_date: string | null;
  batch_number: string | null;
  preparation: "draft" | "ready";
  lifecycle: "open" | "closed_by_reporter";
  close_reason: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  owner_access_id: string;
}

/** Own-report summaries, newest first, opaque-cursor paginated at 20/page. */
export async function listOwnReports(
  accessId: string,
  cursor: string | null,
  client?: SupabaseClient,
): Promise<{ items: ReportSummary[]; nextCursor: string | null }> {
  const supabase = client ?? getServiceClient();
  const offset = decodeCursor(cursor);
  const { data, error } = await supabase
    .from("reports")
    .select(
      "id, product_name, brand, variant, preparation, lifecycle, version, updated_at",
    )
    .eq("owner_access_id", accessId)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + PAGE_SIZE);
  if (error) throw error;

  const rows = data ?? [];
  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE);
  const visibilities = await deriveVisibilities(
    page.map((r) => r.id),
    supabase,
  );

  const items: ReportSummary[] = page.map((r) => ({
    report_id: r.id,
    product_name: r.product_name,
    brand: r.brand,
    variant: r.variant,
    preparation: r.preparation,
    lifecycle: r.lifecycle,
    community_visibility: visibilities.get(r.id) ?? "private",
    version: r.version,
    updated_at: r.updated_at,
  }));

  return { items, nextCursor: hasMore ? encodeCursor(offset + PAGE_SIZE) : null };
}

/** Load and assert ownership of a report row; NOT_FOUND hides other owners' reports. */
export async function loadOwnedReport(
  accessId: string,
  reportId: string,
  client?: SupabaseClient,
): Promise<ReportRow> {
  const supabase = client ?? getServiceClient();
  const { data, error } = await supabase
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();
  if (error) throw error;
  // Return NOT_FOUND for a missing report AND for another owner's report, so
  // existence is never revealed by a guessed id.
  if (!data || data.owner_access_id !== accessId) {
    throw new ApiError("NOT_FOUND", "Report not found.");
  }
  return data as ReportRow;
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

/** Full owner-only aggregate for the private timeline / resume. */
export async function getOwnReport(
  accessId: string,
  reportId: string,
  client?: SupabaseClient,
): Promise<ReportDetail> {
  const supabase = client ?? getServiceClient();
  const report = await loadOwnedReport(accessId, reportId, supabase);

  const [evidenceRes, draftsRes, submissionsRes, updatesRes, revisionsRes] =
    await Promise.all([
      supabase.from("evidence").select("*").eq("report_id", reportId).order("created_at"),
      supabase.from("complaint_drafts").select("*").eq("report_id", reportId),
      supabase.from("submissions").select("*").eq("report_id", reportId).order("submitted_at"),
      supabase.from("updates").select("*").eq("report_id", reportId).order("occurred_at"),
      supabase
        .from("publication_revisions")
        .select("id, source_update_id, state, reason, revision, created_at")
        .eq("report_id", reportId)
        .order("revision", { ascending: false }),
    ]);
  for (const res of [evidenceRes, draftsRes, submissionsRes, updatesRes, revisionsRes]) {
    if (res.error) throw res.error;
  }

  const evidence: EvidenceMeta[] = (evidenceRes.data ?? []).map(mapEvidence);
  const complaint_drafts: ComplaintDraft[] = (draftsRes.data ?? []).map((d) => ({
    id: d.id,
    channel: d.channel,
    subject: d.subject,
    body: d.body,
    method: d.method,
    version: d.version,
    updated_at: d.updated_at,
  }));
  const submissions: Submission[] = (submissionsRes.data ?? []).map((s) => ({
    id: s.id,
    channel: s.channel,
    recipient: s.recipient,
    submitted_at: s.submitted_at,
    reference: s.reference ?? null,
    has_acknowledgement: Boolean(s.acknowledgement_evidence_id),
    created_at: s.created_at,
  }));
  const updates: ReportUpdate[] = (updatesRes.data ?? []).map((u) => ({
    id: u.id,
    submission_id: u.submission_id ?? null,
    kind: u.kind,
    sender: u.sender ?? null,
    occurred_at: u.occurred_at,
    summary: u.summary,
    has_attachment: Boolean(u.evidence_id),
    created_at: u.created_at,
  }));
  const review_requests: ReviewRequestState[] = (revisionsRes.data ?? []).map((r) => ({
    publication_revision_id: r.id,
    content_kind: r.source_update_id ? "response" : "concern",
    state: r.state,
    reason: r.reason ?? null,
    revision: r.revision,
    created_at: r.created_at,
  }));

  const visibilities = await deriveVisibilities([reportId], supabase);

  return {
    report_id: report.id,
    product_id: report.product_id,
    product_name: report.product_name,
    brand: report.brand,
    variant: report.variant,
    concern_text: report.concern_text,
    claim_text: report.claim_text,
    ingredients_text: report.ingredients_text,
    facts_confirmed_at: report.facts_confirmed_at,
    observation_date: report.observation_date,
    batch_number: report.batch_number,
    preparation: report.preparation,
    lifecycle: report.lifecycle,
    close_reason: report.close_reason,
    community_visibility: visibilities.get(reportId) ?? "private",
    version: report.version,
    created_at: report.created_at,
    updated_at: report.updated_at,
    evidence,
    complaint_drafts,
    submissions,
    updates,
    review_requests,
  };
}
