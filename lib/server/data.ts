import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CommunityVisibility,
  ComplaintDraft,
  EvidenceMeta,
  PublicFeedItem,
  PublicReport,
  PublicResponseSummary,
  ReportDetail,
  ReportSummary,
  ReportUpdate,
  ReviewQueueItem,
  ReviewRequestState,
  Submission,
} from "@/lib/contracts";
import { ApiError } from "./errors";
import { getServiceClient } from "./supabase";
import { evidenceStorage } from "./storage";
import { sniffMime } from "./image";

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

// ---------------------------------------------------------------------------
// Public projections and review reads. These read ONLY frozen, approved
// snapshots (publication_revisions.payload) — never private tables recomputed
// into public badges (FOODPROOF_TECHNICAL_SPEC.md §5, FOODPROOF_API_DETAILS.md).
// ---------------------------------------------------------------------------

interface StoredConcernPayload {
  report_id: string;
  product_id: string | null;
  product_name: string;
  brand: string;
  variant: string | null;
  concern_summary: string;
  confirmed_claim_text: string | null;
  confirmed_ingredients_text: string | null;
  observation_date: string | null;
  external_status: PublicFeedItem["external_status"];
}

interface StoredResponsePayload {
  channel: PublicResponseSummary["channel"];
  summary: string;
  occurred_at: string;
  has_attachment: boolean;
  provenance: "user_recorded";
}

function feedItemFrom(
  payload: StoredConcernPayload,
  approvedRevisionId: string,
  publishedAt: string,
): PublicFeedItem {
  return {
    report_id: payload.report_id,
    publication_revision_id: approvedRevisionId,
    product_id: payload.product_id,
    product_name: payload.product_name,
    brand: payload.brand,
    variant: payload.variant,
    concern_summary: payload.concern_summary,
    observation_date: payload.observation_date,
    published_at: publishedAt,
    author_label: "Anonymous contributor",
    external_status: payload.external_status,
  };
}

/** Approved, visible concerns, newest first, opaque-cursor paginated at 20/page. */
export async function getFeed(
  query: { q?: string; cursor?: string },
  client?: SupabaseClient,
): Promise<{ items: PublicFeedItem[]; nextCursor: string | null }> {
  const supabase = client ?? getServiceClient();
  const { data: pubs, error } = await supabase
    .from("publications")
    .select("report_id, approved_revision_id, approved_at")
    .eq("visible", true)
    .order("approved_at", { ascending: false });
  if (error) throw error;

  const revIds = (pubs ?? []).map((p) => p.approved_revision_id);
  const payloads = new Map<string, StoredConcernPayload>();
  if (revIds.length > 0) {
    const { data: revs, error: rErr } = await supabase
      .from("publication_revisions")
      .select("id, payload")
      .in("id", revIds);
    if (rErr) throw rErr;
    for (const r of revs ?? []) payloads.set(r.id, r.payload as StoredConcernPayload);
  }

  const q = query.q?.trim().toLowerCase();
  let items: PublicFeedItem[] = [];
  for (const p of pubs ?? []) {
    const payload = payloads.get(p.approved_revision_id);
    if (!payload) continue;
    items.push(feedItemFrom(payload, p.approved_revision_id, p.approved_at));
  }
  if (q) {
    items = items.filter(
      (i) =>
        i.brand.toLowerCase().includes(q) || i.product_name.toLowerCase().includes(q),
    );
  }

  const offset = decodeCursor(query.cursor);
  const page = items.slice(offset, offset + PAGE_SIZE);
  const hasMore = items.length > offset + PAGE_SIZE;
  return { items: page, nextCursor: hasMore ? encodeCursor(offset + PAGE_SIZE) : null };
}

/** Full approved concern projection plus approved response summaries. */
export async function getPublicReport(
  reportId: string,
  client?: SupabaseClient,
): Promise<PublicReport> {
  const supabase = client ?? getServiceClient();
  const { data: pub, error } = await supabase
    .from("publications")
    .select("approved_revision_id, approved_at, visible")
    .eq("report_id", reportId)
    .maybeSingle();
  if (error) throw error;
  if (!pub || !pub.visible) throw new ApiError("NOT_FOUND", "Concern not found.");

  const { data: rev, error: rErr } = await supabase
    .from("publication_revisions")
    .select("payload")
    .eq("id", pub.approved_revision_id)
    .single();
  if (rErr) throw rErr;
  const payload = rev.payload as StoredConcernPayload;

  const { data: assets, error: aErr } = await supabase
    .from("publication_assets")
    .select("id")
    .eq("revision_id", pub.approved_revision_id);
  if (aErr) throw aErr;

  const { data: respRevs, error: respErr } = await supabase
    .from("publication_revisions")
    .select("id, payload")
    .eq("report_id", reportId)
    .not("source_update_id", "is", null)
    .eq("state", "approved")
    .order("revision", { ascending: true });
  if (respErr) throw respErr;

  const responses: PublicResponseSummary[] = (respRevs ?? []).map((r) => {
    const p = r.payload as StoredResponsePayload;
    return {
      publication_revision_id: r.id,
      channel: p.channel,
      summary: p.summary,
      occurred_at: p.occurred_at,
      has_attachment: p.has_attachment,
      provenance: "user_recorded",
    };
  });

  const base = feedItemFrom(payload, pub.approved_revision_id, pub.approved_at);
  return {
    ...base,
    confirmed_claim_text: payload.confirmed_claim_text,
    confirmed_ingredients_text: payload.confirmed_ingredients_text,
    approved_asset_ids: (assets ?? []).map((a) => a.id),
    responses,
  };
}

/** Reviewer queue: pending review requests plus open flags. */
export async function getReviewQueue(
  client?: SupabaseClient,
): Promise<{
  items: ReviewQueueItem[];
  flags: { id: string; report_id: string; reason: string; created_at: string }[];
}> {
  const supabase = client ?? getServiceClient();
  const { data: revs, error } = await supabase
    .from("publication_revisions")
    .select("id, report_id, source_update_id, revision, created_at")
    .eq("state", "pending_review")
    .order("created_at", { ascending: true });
  if (error) throw error;

  const items: ReviewQueueItem[] = (revs ?? []).map((r) => ({
    publication_revision_id: r.id,
    report_id: r.report_id,
    content_kind: r.source_update_id ? "response" : "concern",
    request_type: r.source_update_id ? "response" : r.revision > 1 ? "correction" : "report",
    requested_at: r.created_at,
  }));

  const { data: flags, error: fErr } = await supabase
    .from("content_flags")
    .select("id, report_id, reason, created_at")
    .eq("state", "open")
    .order("created_at", { ascending: true });
  if (fErr) throw fErr;

  return { items, flags: flags ?? [] };
}

/** Reviewer detail: the exact frozen snapshot and its associated asset ids. */
export async function getReviewDetail(
  revisionId: string,
  client?: SupabaseClient,
): Promise<{
  publication_revision_id: string;
  report_id: string;
  content_kind: "concern" | "response";
  state: string;
  revision: number;
  reason: string | null;
  payload: unknown;
  asset_ids: string[];
  created_at: string;
}> {
  const supabase = client ?? getServiceClient();
  const { data: rev, error } = await supabase
    .from("publication_revisions")
    .select("id, report_id, source_update_id, state, revision, reason, payload, created_at")
    .eq("id", revisionId)
    .maybeSingle();
  if (error) throw error;
  if (!rev) throw new ApiError("NOT_FOUND", "Review request not found.");

  const { data: assets, error: aErr } = await supabase
    .from("publication_assets")
    .select("id")
    .eq("revision_id", revisionId);
  if (aErr) throw aErr;

  return {
    publication_revision_id: rev.id,
    report_id: rev.report_id,
    content_kind: rev.source_update_id ? "response" : "concern",
    state: rev.state,
    revision: rev.revision,
    reason: rev.reason ?? null,
    payload: rev.payload,
    asset_ids: (assets ?? []).map((a) => a.id),
    created_at: rev.created_at,
  };
}

/**
 * Guarded publication-asset bytes: any valid session while the parent is
 * currently visible, or a reviewer while the revision is pending review. Never a
 * public URL; withdrawal/removal takes effect for subsequent requests.
 */
export async function readPublicationAssetForMedia(
  actor: { accessId: string; role: "user" | "reviewer" },
  assetId: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const supabase = getServiceClient();
  const { data: asset, error } = await supabase
    .from("publication_assets")
    .select("object_path, revision_id")
    .eq("id", assetId)
    .maybeSingle();
  if (error) throw error;
  if (!asset) throw new ApiError("NOT_FOUND", "Asset not found.");

  const { data: rev, error: rErr } = await supabase
    .from("publication_revisions")
    .select("report_id, source_update_id, state")
    .eq("id", asset.revision_id)
    .single();
  if (rErr) throw rErr;

  let permitted = actor.role === "reviewer" && rev.state === "pending_review";
  if (!permitted) {
    const { data: pub, error: pErr } = await supabase
      .from("publications")
      .select("approved_revision_id, visible")
      .eq("report_id", rev.report_id)
      .maybeSingle();
    if (pErr) throw pErr;
    if (pub && pub.visible) {
      permitted = rev.source_update_id
        ? rev.state === "approved"
        : pub.approved_revision_id === asset.revision_id;
    }
  }
  if (!permitted) throw new ApiError("NOT_FOUND", "Asset not found.");

  const bytes = await evidenceStorage.readBytes(asset.object_path as string);
  return { bytes, mimeType: sniffMime(bytes) ?? "application/octet-stream" };
}
